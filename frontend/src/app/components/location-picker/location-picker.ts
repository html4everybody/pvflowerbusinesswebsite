import {
  Component, Input, Output, EventEmitter, ElementRef, ViewChild,
  AfterViewInit, OnDestroy, signal,
} from '@angular/core';
import { FormsModule } from '@angular/forms';
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
  placePrediction: any;
}

declare var google: any;

const DEFAULT_CENTER = { lat: 20.5937, lng: 78.9629 };
const DEFAULT_ZOOM = 5;
const PIN_ZOOM = 16;

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

  private gMap: any = null;
  private gMarker: any = null;
  private searchDebounce: ReturnType<typeof setTimeout> | null = null;

  async ngAfterViewInit(): Promise<void> {
    const hasInitial = this.initialLat != null && this.initialLng != null;
    const center = hasInitial
      ? { lat: this.initialLat!, lng: this.initialLng! }
      : DEFAULT_CENTER;

    const { Map } = await google.maps.importLibrary('maps');

    this.gMap = new Map(this.mapEl.nativeElement, {
      center,
      zoom: hasInitial ? PIN_ZOOM : DEFAULT_ZOOM,
      mapTypeControl: false,
      streetViewControl: false,
      fullscreenControl: false,
      zoomControlOptions: { position: 9 },
    });

    this.gMarker = new google.maps.Marker({
      map: this.gMap,
      position: center,
      draggable: true,
      visible: hasInitial,
    });

    this.gMarker.addListener('dragend', () => {
      const pos = this.gMarker.getPosition();
      this.resolveLocation(pos.lat(), pos.lng());
    });

    this.gMap.addListener('click', (e: any) => {
      this.gMarker.setPosition(e.latLng);
      this.gMarker.setVisible(true);
      this.resolveLocation(e.latLng.lat(), e.latLng.lng());
    });

    if (hasInitial) {
      this.resolveLocation(this.initialLat!, this.initialLng!);
    }
  }

  ngOnDestroy(): void {
    if (this.searchDebounce) clearTimeout(this.searchDebounce);
  }

  onSearchInput(): void {
    const q = this.searchQuery();
    if (this.searchDebounce) clearTimeout(this.searchDebounce);
    if (q.trim().length < 2) {
      this.suggestions.set([]);
      this.showResults.set(false);
      return;
    }
    this.searchDebounce = setTimeout(async () => {
      this.searching.set(true);
      try {
        const { AutocompleteSuggestion } = await google.maps.importLibrary('places');
        const { suggestions } = await AutocompleteSuggestion.fetchAutocompleteSuggestions({
          input: q,
          includedRegionCodes: ['in'],
        });
        this.suggestions.set(suggestions.map((s: any) => ({
          display_name: s.placePrediction.text.toString(),
          placePrediction: s.placePrediction,
        })));
        this.showResults.set(suggestions.length > 0);
      } catch {
        this.suggestions.set([]);
        this.showResults.set(false);
      } finally {
        this.searching.set(false);
      }
    }, 300);
  }

  async pickSuggestion(s: PlaceSuggestion): Promise<void> {
    this.showResults.set(false);
    this.searchQuery.set(s.display_name);
    try {
      const place = s.placePrediction.toPlace();
      await place.fetchFields({ fields: ['location', 'addressComponents', 'formattedAddress'] });
      const lat = place.location.lat();
      const lng = place.location.lng();
      const picked = this.extractFromPlace(place, lat, lng);
      this.applyPicked(picked);
      this.gMap.setCenter({ lat, lng });
      this.gMap.setZoom(PIN_ZOOM);
      this.gMarker.setPosition({ lat, lng });
      this.gMarker.setVisible(true);
    } catch (e) {
      console.error('Place details error:', e);
    }
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
        this.gMap.setCenter({ lat: latitude, lng: longitude });
        this.gMap.setZoom(PIN_ZOOM);
        this.gMarker.setPosition({ lat: latitude, lng: longitude });
        this.gMarker.setVisible(true);
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
    try {
      const { Geocoder } = await google.maps.importLibrary('geocoding');
      const geocoder = new Geocoder();
      const result = await geocoder.geocode({ location: { lat, lng } });
      if (result.results?.length) {
        const r = result.results[0];
        const get = (type: string) =>
          r.address_components.find((c: any) => c.types.includes(type))?.long_name || '';
        const picked: PickedLocation = {
          latitude: lat, longitude: lng,
          address: r.formatted_address,
          city: get('locality') || get('administrative_area_level_2'),
          state: get('administrative_area_level_1'),
          pincode: get('postal_code'),
        };
        this.searchQuery.set(r.formatted_address);
        this.applyPicked(picked);
      }
    } catch {
      this.applyPicked({ latitude: lat, longitude: lng, address: '', city: '', state: '', pincode: '' });
    }
  }

  private extractFromPlace(place: any, lat: number, lng: number): PickedLocation {
    const components = place.addressComponents || [];
    const get = (type: string) =>
      components.find((c: any) => c.types.includes(type))?.longText || '';
    return {
      latitude: lat, longitude: lng,
      address: place.formattedAddress || '',
      city: get('locality') || get('administrative_area_level_2'),
      state: get('administrative_area_level_1'),
      pincode: get('postal_code'),
    };
  }

  private applyPicked(loc: PickedLocation): void {
    this.selected.set(loc);
    this.locationPicked.emit(loc);
  }
}
