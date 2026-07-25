import {
  Component, Input, Output, EventEmitter, ElementRef, ViewChild,
  AfterViewInit, OnDestroy, signal,
} from '@angular/core';
import { FormsModule } from '@angular/forms';
import * as L from 'leaflet';
import { GeocodeService } from '../../services/geocode';
import { environment } from '../../../environments/environment';

export interface PickedLocation {
  latitude: number;
  longitude: number;
  address: string;
  city: string;
  state: string;
  pincode: string;
}

interface PlaceSuggestion {
  display_name: string;
  placeId: string;
}

declare var google: any;

const DEFAULT_CENTER: [number, number] = [20.5937, 78.9629];
const DEFAULT_ZOOM = 5;
const PIN_ZOOM = 16;

// Launch city is Hyderabad only — mirrors _HYDERABAD_BOUNDS in backend/main.py.
// Google's own componentRestrictions only narrows to "India" (there's no
// India-Places-API concept of a metro-area restriction), so the actual
// Hyderabad-only enforcement has to happen here on the client, on every
// path that can produce a PickedLocation (autocomplete pick, pin drag/
// click, "use my location") — not just the initial suggestion list.
const HYDERABAD_BOUNDS = { minLat: 17.20, maxLat: 17.65, minLng: 78.20, maxLng: 78.75 };
function isInHyderabad(lat: number, lng: number): boolean {
  return lat >= HYDERABAD_BOUNDS.minLat && lat <= HYDERABAD_BOUNDS.maxLat
      && lng >= HYDERABAD_BOUNDS.minLng && lng <= HYDERABAD_BOUNDS.maxLng;
}
const OUTSIDE_HYDERABAD_MSG = 'VivaPetals currently delivers within Hyderabad only — please pick a location inside the city.';

let _gmapsPromise: Promise<void> | null = null;

function ensureGoogleMaps(apiKey: string): Promise<void> {
  if (_gmapsPromise) return _gmapsPromise;
  _gmapsPromise = new Promise((resolve) => {
    if (typeof google !== 'undefined' && google.maps?.places) { resolve(); return; }
    (window as any).__gmCb = () => resolve();
    const s = document.createElement('script');
    s.src = `https://maps.googleapis.com/maps/api/js?key=${apiKey}&libraries=places&callback=__gmCb`;
    s.async = true;
    document.head.appendChild(s);
  });
  return _gmapsPromise;
}

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
  suggestions = signal<PlaceSuggestion[]>([]);
  searching = signal(false);
  locating = signal(false);
  showResults = signal(false);
  selected = signal<PickedLocation | null>(null);
  errorMsg = signal('');

  private map!: L.Map;
  private marker!: L.Marker;
  private searchDebounce: ReturnType<typeof setTimeout> | null = null;
  private autocompleteService: any = null;
  private placesService: any = null;

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
        if (r) this.applyPicked({
          latitude: this.initialLat!, longitude: this.initialLng!,
          address: r.address, city: r.city, state: r.state, pincode: r.pincode,
        });
      });
    }

    ensureGoogleMaps(environment.googleMapsApiKey).then(() => {
      this.autocompleteService = new google.maps.places.AutocompleteService();
      this.placesService = new google.maps.places.PlacesService(this.mapEl.nativeElement);
    });
  }

  ngOnDestroy(): void {
    if (this.searchDebounce) clearTimeout(this.searchDebounce);
    this.map?.remove();
  }

  onSearchInput(): void {
    const q = this.searchQuery();
    if (this.searchDebounce) clearTimeout(this.searchDebounce);
    if (q.trim().length < 2) {
      this.suggestions.set([]);
      this.showResults.set(false);
      return;
    }
    this.searchDebounce = setTimeout(() => {
      if (!this.autocompleteService) return;
      this.searching.set(true);
      const bounds = new google.maps.LatLngBounds(
        { lat: HYDERABAD_BOUNDS.minLat, lng: HYDERABAD_BOUNDS.minLng },
        { lat: HYDERABAD_BOUNDS.maxLat, lng: HYDERABAD_BOUNDS.maxLng },
      );
      this.autocompleteService.getPlacePredictions(
        // locationBias narrows suggestions toward Hyderabad — Google Places
        // has no hard "restrict to this metro area" mode, so this only
        // biases ranking; pickSuggestion() below still hard-checks the
        // resolved coordinates before accepting anything.
        { input: q, componentRestrictions: { country: 'in' }, locationBias: bounds },
        (predictions: any[], status: string) => {
          this.searching.set(false);
          if (status !== 'OK' || !predictions?.length) {
            this.suggestions.set([]);
            this.showResults.set(false);
            return;
          }
          this.suggestions.set(predictions.map(p => ({
            display_name: p.description,
            placeId: p.place_id,
          })));
          this.showResults.set(true);
        },
      );
    }, 300);
  }

  pickSuggestion(s: PlaceSuggestion): void {
    this.showResults.set(false);
    this.searchQuery.set(s.display_name);
    if (!this.placesService) return;
    this.errorMsg.set('');
    this.placesService.getDetails(
      { placeId: s.placeId, fields: ['geometry', 'address_components', 'formatted_address'] },
      (place: any, status: string) => {
        if (status !== 'OK' || !place?.geometry) return;
        const lat = place.geometry.location.lat();
        const lng = place.geometry.location.lng();
        if (!isInHyderabad(lat, lng)) {
          this.errorMsg.set(OUTSIDE_HYDERABAD_MSG);
          this.searchQuery.set('');
          return;
        }
        const get = (type: string) =>
          (place.address_components || []).find((c: any) => c.types.includes(type))?.long_name || '';
        const picked: PickedLocation = {
          latitude: lat, longitude: lng,
          address: place.formatted_address || s.display_name,
          city: get('locality') || get('administrative_area_level_2'),
          state: get('administrative_area_level_1'),
          pincode: get('postal_code'),
        };
        this.applyPicked(picked);
        this.map.setView([lat, lng], PIN_ZOOM);
        this.marker.setLatLng([lat, lng]);
        this.marker.setOpacity(1);
      },
    );
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
      { enableHighAccuracy: true, timeout: 10000 },
    );
  }

  locationSubtitle(loc: PickedLocation): string {
    return [loc.city, loc.state, loc.pincode].filter(v => v).join(', ');
  }

  private async resolveLocation(lat: number, lng: number): Promise<void> {
    this.errorMsg.set('');
    // Checked here too, not just in pickSuggestion — a dropped pin/map
    // click/"use my location" never goes through Google Places at all, so
    // without this check those paths could silently accept a location
    // outside Hyderabad (the backend reverse-geocode call below still
    // rejects it, but GeocodeService.reverse() swallows that as a plain
    // null, which previously fell through to accepting blank-address
    // coordinates instead of telling the customer why nothing came back).
    if (!isInHyderabad(lat, lng)) {
      this.errorMsg.set(OUTSIDE_HYDERABAD_MSG);
      return;
    }
    const r = await this.geocode.reverse(lat, lng);
    if (r) {
      this.applyPicked({ latitude: lat, longitude: lng, address: r.address, city: r.city, state: r.state, pincode: r.pincode });
      this.searchQuery.set(r.display_name);
    } else {
      this.applyPicked({ latitude: lat, longitude: lng, address: '', city: '', state: '', pincode: '' });
    }
  }

  private applyPicked(loc: PickedLocation): void {
    this.selected.set(loc);
    this.locationPicked.emit(loc);
  }
}
