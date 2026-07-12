import {
  Component, Input, Output, EventEmitter, ElementRef, ViewChild,
  AfterViewInit, OnDestroy, signal,
} from '@angular/core';
import { FormsModule } from '@angular/forms';
import * as L from 'leaflet';
import { GeocodeService, GeocodeResult } from '../../services/geocode';

export interface PickedLocation {
  latitude: number;
  longitude: number;
  address: string;
  city: string;
  state: string;
  pincode: string;
}

const DEFAULT_CENTER: [number, number] = [20.5937, 78.9629]; // India
const DEFAULT_ZOOM = 5;
const PIN_ZOOM = 16;

function pinIcon(): L.DivIcon {
  return L.divIcon({
    className: 'lp-pin',
    html: `<svg width="34" height="44" viewBox="0 0 34 44" xmlns="http://www.w3.org/2000/svg">
      <path d="M17 0C7.6 0 0 7.6 0 17c0 12 17 27 17 27s17-15 17-27C34 7.6 26.4 0 17 0z" fill="var(--accent, #2563eb)"/>
      <circle cx="17" cy="17" r="7" fill="#fff"/>
    </svg>`,
    iconSize: [34, 44],
    iconAnchor: [17, 44],
  });
}

/**
 * Free, card-free location picker: Leaflet + OpenStreetMap tiles + our own
 * Nominatim proxy for search/reverse-geocode, plus the browser's native
 * Geolocation API for "use my current location". No API key needed.
 */
@Component({
  selector: 'app-location-picker',
  standalone: true,
  imports: [FormsModule],
  templateUrl: './location-picker.html',
  styleUrl: './location-picker.scss',
})
export class LocationPicker implements AfterViewInit, OnDestroy {
  @Input() initialLat?: number | null;
  @Input() initialLng?: number | null;
  @Input() height = '320px';
  @Output() locationPicked = new EventEmitter<PickedLocation>();

  @ViewChild('mapEl', { static: true }) mapEl!: ElementRef<HTMLDivElement>;

  searchQuery = signal('');
  results = signal<GeocodeResult[]>([]);
  searching = signal(false);
  locating = signal(false);
  showResults = signal(false);
  selected = signal<PickedLocation | null>(null);
  errorMsg = signal('');

  private map!: L.Map;
  private marker!: L.Marker;
  private searchDebounce: ReturnType<typeof setTimeout> | null = null;

  constructor(private geocode: GeocodeService) {}

  ngAfterViewInit(): void {
    const hasInitial = this.initialLat != null && this.initialLng != null;
    const center: [number, number] = hasInitial ? [this.initialLat!, this.initialLng!] : DEFAULT_CENTER;

    this.map = L.map(this.mapEl.nativeElement, {
      center, zoom: hasInitial ? PIN_ZOOM : DEFAULT_ZOOM, zoomControl: true,
    });

    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
      maxZoom: 19,
    }).addTo(this.map);

    this.marker = L.marker(center, { icon: pinIcon(), draggable: true }).addTo(this.map);
    if (!hasInitial) this.marker.setOpacity(0);

    this.marker.on('dragend', () => {
      const pos = this.marker.getLatLng();
      this.resolveLocation(pos.lat, pos.lng);
    });

    this.map.on('click', (e: L.LeafletMouseEvent) => {
      this.marker.setLatLng(e.latlng);
      this.marker.setOpacity(1);
      this.resolveLocation(e.latlng.lat, e.latlng.lng);
    });

    if (hasInitial) {
      this.geocode.reverse(this.initialLat!, this.initialLng!).then(r => {
        if (r) this.applyResult(r);
      });
    }
  }

  ngOnDestroy(): void {
    if (this.searchDebounce) clearTimeout(this.searchDebounce);
    this.map?.remove();
  }

  onSearchInput(): void {
    const q = this.searchQuery();
    if (this.searchDebounce) clearTimeout(this.searchDebounce);
    if (q.trim().length < 3) {
      this.results.set([]);
      this.showResults.set(false);
      return;
    }
    this.searchDebounce = setTimeout(async () => {
      this.searching.set(true);
      const r = await this.geocode.search(q);
      this.results.set(r);
      this.showResults.set(true);
      this.searching.set(false);
    }, 400);
  }

  pickResult(r: GeocodeResult): void {
    this.showResults.set(false);
    this.searchQuery.set(r.display_name);
    if (r.latitude == null || r.longitude == null) return;
    this.applyResult(r);
    this.map.setView([r.latitude, r.longitude], PIN_ZOOM);
    this.marker.setLatLng([r.latitude, r.longitude]);
    this.marker.setOpacity(1);
  }

  useMyLocation(): void {
    if (!navigator.geolocation) {
      this.errorMsg.set('Your browser does not support location detection.');
      return;
    }
    this.locating.set(true);
    this.errorMsg.set('');
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        this.locating.set(false);
        const { latitude, longitude } = pos.coords;
        this.map.setView([latitude, longitude], PIN_ZOOM);
        this.marker.setLatLng([latitude, longitude]);
        this.marker.setOpacity(1);
        this.resolveLocation(latitude, longitude);
      },
      () => {
        this.locating.set(false);
        this.errorMsg.set('Could not get your location. Please allow location access, or search/click on the map instead.');
      },
      { enableHighAccuracy: true, timeout: 10000 }
    );
  }

  private async resolveLocation(lat: number, lng: number): Promise<void> {
    this.errorMsg.set('');
    const r = await this.geocode.reverse(lat, lng);
    if (r) {
      this.applyResult({ ...r, latitude: lat, longitude: lng });
      this.searchQuery.set(r.display_name);
    } else {
      const picked: PickedLocation = { latitude: lat, longitude: lng, address: '', city: '', state: '', pincode: '' };
      this.selected.set(picked);
      this.locationPicked.emit(picked);
    }
  }

  locationSubtitle(loc: PickedLocation): string {
    return [loc.city, loc.state, loc.pincode].filter(v => v).join(', ');
  }

  private applyResult(r: GeocodeResult): void {
    const picked: PickedLocation = {
      latitude: r.latitude!, longitude: r.longitude!,
      address: r.address, city: r.city, state: r.state, pincode: r.pincode,
    };
    this.selected.set(picked);
    this.locationPicked.emit(picked);
  }
}
