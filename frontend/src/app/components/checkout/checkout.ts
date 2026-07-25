import { Component, signal, computed, effect, ViewChild, ElementRef } from '@angular/core';
import { Router, RouterLink } from '@angular/router';
import { ViewportScroller } from '@angular/common';
import { FormsModule, NgForm } from '@angular/forms';
import { HttpClient } from '@angular/common/http';
import { CartService } from '../../services/cart';
import { AuthService } from '../../services/auth';
import { ConfettiService } from '../../services/confetti';
import { LoyaltyService } from '../../services/loyalty';
import { PromoService, PromoResult, SeasonalOffer } from '../../services/promo';
import { environment } from '../../../environments/environment';
import { CommonModule } from '@angular/common';
import { DatePicker } from '../date-picker/date-picker';
import { GeocodeService } from '../../services/geocode';
import { AddressesService, SavedAddress } from '../../services/addresses';

declare var google: any;

interface AddressSuggestion {
  display_name: string;
  placePrediction: any;
}

@Component({
  selector: 'app-checkout',
  imports: [RouterLink, FormsModule, CommonModule, DatePicker],
  templateUrl: './checkout.html',
  styleUrl: './checkout.scss'
})
export class Checkout {
  orderPlaced = signal(false);
  orderNumber = signal('');
  loading = signal(false);
  errorMessage = signal('');
  deliveryType = signal<'immediate' | 'scheduled'>('immediate');
  isRecurring = signal(false);

  loyaltyBalance = signal(0);
  loyaltyEnabled = signal(false);
  pointsToRedeem = signal(0);
  redemptionRate = signal(10);
  pointsDiscountAmount = computed(() =>
    this.loyaltyEnabled() ? +(this.pointsToRedeem() / this.redemptionRate()).toFixed(2) : 0
  );
  pointsEarned = signal(0);
  newLoyaltyBalance = signal(0);

  promoCode = signal('');
  promoResult = signal<PromoResult | null>(null);
  promoLoading = signal(false);
  promoError = signal('');
  promoDiscountAmount = computed(() => this.promoResult()?.discount_amount ?? 0);
  availableOffers = signal<SeasonalOffer[]>([]);

  minDate = new Date().toISOString().split('T')[0];

  get effectiveMinDate(): string {
    const now = new Date();
    if (now.getHours() >= 15) {
      const t = new Date(now);
      t.setDate(t.getDate() + 1);
      return t.toISOString().split('T')[0];
    }
    return this.minDate;
  }

  formatSelectedDate(d: string): string {
    if (!d) return '';
    return new Date(d + 'T12:00:00').toLocaleDateString('en-US',
      { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' });
  }

  get availableTimeSlots(): { value: string; label: string }[] {
    const all = [
      { value: '09:00', label: '9:00 AM – 11:00 AM' },
      { value: '11:00', label: '11:00 AM – 1:00 PM' },
      { value: '13:00', label: '1:00 PM – 3:00 PM' },
      { value: '15:00', label: '3:00 PM – 5:00 PM' },
      { value: '17:00', label: '5:00 PM – 7:00 PM' },
    ];
    if (this.formData.deliveryDate === this.minDate) {
      const h = new Date().getHours();
      return all.filter(s => parseInt(s.value) > h + 1);
    }
    return all;
  }

  getSelectedTimeLabel(): string {
    return this.availableTimeSlots.find(s => s.value === this.formData.deliveryTime)?.label ?? this.formData.deliveryTime;
  }

  get isScheduleComplete(): boolean {
    return this.deliveryType() === 'scheduled'
      && !!this.formData.deliveryDate
      && !!this.formData.deliveryTime;
  }

  get annualRecurrenceDisplay(): string {
    if (!this.formData.deliveryDate) return '';
    try {
      const d = new Date(this.formData.deliveryDate + 'T12:00:00');
      d.setFullYear(d.getFullYear() + 1);
      return d.toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' });
    } catch { return ''; }
  }

  selectImmediate(): void {
    this.deliveryType.set('immediate');
    this.formData.deliveryDate = '';
    this.formData.deliveryTime = '';
    this.isRecurring.set(false);
  }

  paymentMethod = signal<'card' | 'cod' | 'upi'>('card');

  zipLookupLoading = signal(false);
  zipLookupError = signal('');

  citySuggestions = signal<{ city: string; state: string }[]>([]);
  showCitySuggestions = signal(false);
  private citySearchTimer: any;

  readonly indianStates: string[] = [
    'Andaman and Nicobar Islands', 'Andhra Pradesh', 'Arunachal Pradesh', 'Assam',
    'Bihar', 'Chandigarh', 'Chhattisgarh',
    'Dadra and Nagar Haveli and Daman and Diu', 'Delhi',
    'Goa', 'Gujarat', 'Haryana', 'Himachal Pradesh',
    'Jammu and Kashmir', 'Jharkhand', 'Karnataka', 'Kerala',
    'Ladakh', 'Lakshadweep', 'Madhya Pradesh', 'Maharashtra',
    'Manipur', 'Meghalaya', 'Mizoram', 'Nagaland', 'Odisha',
    'Puducherry', 'Punjab', 'Rajasthan', 'Sikkim', 'Tamil Nadu',
    'Telangana', 'Tripura', 'Uttar Pradesh', 'Uttarakhand', 'West Bengal'
  ];

  onCityInput(): void {
    const query = this.formData.city.trim();
    clearTimeout(this.citySearchTimer);
    this.citySuggestions.set([]);
    if (query.length < 2) {
      this.showCitySuggestions.set(false);
      return;
    }
    this.citySearchTimer = setTimeout(async () => {
      const res = await this.geocodeService.search(query);
      const seen = new Set<string>();
      const suggestions = res
        .map(r => ({ city: r.city, state: r.state }))
        .filter(s => {
          if (!s.city || seen.has(s.city.toLowerCase())) return false;
          seen.add(s.city.toLowerCase());
          return true;
        });
      this.citySuggestions.set(suggestions);
      this.showCitySuggestions.set(suggestions.length > 0);
    }, 350);
  }

  selectCitySuggestion(s: { city: string; state: string }): void {
    this.formData.city = s.city;
    if (s.state) this.formData.state = s.state;
    this.showCitySuggestions.set(false);
    this.citySuggestions.set([]);
  }

  hideCitySuggestions(): void {
    setTimeout(() => this.showCitySuggestions.set(false), 150);
  }

  async onZipChange(): Promise<void> {
    const zip = this.formData.zip.trim();
    if (zip.length !== 6 || !/^\d{6}$/.test(zip)) {
      this.zipLookupError.set('');
      return;
    }
    this.zipLookupLoading.set(true);
    this.zipLookupError.set('');
    try {
      // First check if we deliver to this pincode
      const coverage = await this.http.get<{ covered: boolean; zone_name?: string }>(
        `${environment.apiUrl}/api/delivery-zones/check`, { params: { query: zip } }
      ).toPromise();

      if (!coverage?.covered) {
        this.zipLookupLoading.set(false);
        this.zipLookupError.set('Sorry, we don\'t deliver to this pincode yet. We currently deliver within Hyderabad.');
        return;
      }

      // Pincode is serviceable — autofill city/state via Google
      const { Geocoder } = await google.maps.importLibrary('geocoding');
      const result = await new Geocoder().geocode({ address: zip + ', India' });
      this.zipLookupLoading.set(false);
      if (result.results?.length) {
        const r = result.results[0];
        const get = (type: string) =>
          r.address_components.find((c: any) => c.types.includes(type))?.long_name || '';
        const city = get('locality') || get('administrative_area_level_2');
        const state = get('administrative_area_level_1');
        if (city) this.formData.city = city;
        if (state) this.formData.state = state;
        this.formData.latitude = r.geometry.location.lat();
        this.formData.longitude = r.geometry.location.lng();
        this.refreshDeliveryFee();
      } else {
        this.zipLookupError.set('Pincode not found');
      }
    } catch {
      this.zipLookupLoading.set(false);
      this.zipLookupError.set('Pincode not found');
    }
  }

  onAddressInput(): void {
    const q = this.formData.address.trim();
    if (this.addressDebounce) clearTimeout(this.addressDebounce);
    if (q.length < 3) { this.addressSuggestions.set([]); this.showAddressSuggestions.set(false); return; }
    this.addressDebounce = setTimeout(async () => {
      this.addressSearching.set(true);
      try {
        const { AutocompleteSuggestion } = await google.maps.importLibrary('places');
        const { suggestions } = await AutocompleteSuggestion.fetchAutocompleteSuggestions({
          input: q, includedRegionCodes: ['in'],
        });
        this.addressSuggestions.set(suggestions.map((s: any) => ({
          display_name: s.placePrediction.text.toString(),
          placePrediction: s.placePrediction,
        })));
        this.showAddressSuggestions.set(suggestions.length > 0);
      } catch { this.addressSuggestions.set([]); this.showAddressSuggestions.set(false); }
      finally { this.addressSearching.set(false); }
    }, 300);
  }

  async pickAddressSuggestion(s: AddressSuggestion): Promise<void> {
    this.showAddressSuggestions.set(false);
    try {
      const place = s.placePrediction.toPlace();
      await place.fetchFields({ fields: ['location', 'addressComponents', 'formattedAddress'] });
      const get = (type: string) =>
        (place.addressComponents || []).find((c: any) => c.types.includes(type))?.longText || '';
      // Strip city, state, country (last 3 comma-separated parts) from the suggestion text
      const parts = s.display_name.split(', ');
      this.formData.address = parts.length > 3 ? parts.slice(0, -3).join(', ') : s.display_name;
      this.formData.city = get('locality') || get('administrative_area_level_2');
      this.formData.state = get('administrative_area_level_1');
      this.formData.zip = get('postal_code');
      this.formData.latitude = place.location.lat();
      this.formData.longitude = place.location.lng();
      this.selectedSavedAddressId.set(null);
      this.refreshDeliveryFee();
    } catch (e) { console.error('Place details error:', e); }
  }

  hideAddressSuggestions(): void {
    setTimeout(() => this.showAddressSuggestions.set(false), 150);
  }

  useCurrentLocation(): void {
    if (!navigator.geolocation) {
      this.locatingError.set('Location not supported by your browser.');
      return;
    }
    this.locatingAddress.set(true);
    this.locatingError.set('');
    navigator.geolocation.getCurrentPosition(
      async (pos) => {
        try {
          await this.applyLatLng(pos.coords.latitude, pos.coords.longitude);
        } finally {
          this.locatingAddress.set(false);
        }
      },
      () => {
        this.locatingAddress.set(false);
        this.locatingError.set('Could not get your location. Please allow location access.');
      },
      { enableHighAccuracy: true, timeout: 10000 },
    );
  }

  async openMapModal(): Promise<void> {
    this.showMapModal.set(true);
    this.mapPinAddress.set('');
    await new Promise(r => setTimeout(r, 50)); // let Angular render the modal DOM

    // Move overlay to <body> so position:fixed works regardless of parent transforms
    const overlay = document.querySelector('.map-modal-overlay') as HTMLElement;
    if (overlay) {
      document.body.appendChild(overlay);
      document.body.style.overflow = 'hidden';
    }

    const center = this.formData.latitude && this.formData.longitude
      ? { lat: this.formData.latitude, lng: this.formData.longitude }
      : { lat: 17.385, lng: 78.4867 }; // Hyderabad fallback

    const { Map } = await google.maps.importLibrary('maps');
    this.modalMap = new Map(this.modalMapEl.nativeElement, {
      center,
      zoom: this.formData.latitude ? 16 : 12,
      mapTypeControl: false,
      streetViewControl: false,
      fullscreenControl: false,
    });

    this.modalMarker = new google.maps.Marker({
      map: this.modalMap,
      position: center,
      draggable: true,
      visible: !!(this.formData.latitude && this.formData.longitude),
    });

    if (this.formData.latitude && this.formData.longitude) {
      this.resolveMapPin(center.lat, center.lng);
    }

    this.modalMarker.addListener('dragend', () => {
      const p = this.modalMarker.getPosition();
      this.resolveMapPin(p.lat(), p.lng());
    });

    this.modalMap.addListener('click', (e: any) => {
      this.modalMarker.setPosition(e.latLng);
      this.modalMarker.setVisible(true);
      this.resolveMapPin(e.latLng.lat(), e.latLng.lng());
    });
  }

  closeMapModal(): void {
    document.body.style.overflow = '';
    this.showMapModal.set(false);
    this.modalMap = null;
    this.modalMarker = null;
    this.mapPinAddress.set('');
  }

  private _pendingPinLat: number | null = null;
  private _pendingPinLng: number | null = null;

  private async resolveMapPin(lat: number, lng: number): Promise<void> {
    this._pendingPinLat = lat;
    this._pendingPinLng = lng;
    this.mapPinResolving.set(true);
    this.mapPinAddress.set('');
    try {
      const { Geocoder } = await google.maps.importLibrary('geocoding');
      const result = await new Geocoder().geocode({ location: { lat, lng } });
      if (lat !== this._pendingPinLat || lng !== this._pendingPinLng) return;
      if (result.results?.length) {
        const r = result.results[0];
        const parts = r.formatted_address.split(', ');
        this.mapPinAddress.set(parts.length > 3 ? parts.slice(0, -3).join(', ') : r.formatted_address);
      }
    } finally {
      if (lat === this._pendingPinLat && lng === this._pendingPinLng) {
        this.mapPinResolving.set(false);
      }
    }
  }

  async confirmMapPin(): Promise<void> {
    if (this._pendingPinLat == null || this._pendingPinLng == null) return;
    await this.applyLatLng(this._pendingPinLat, this._pendingPinLng);
    this.closeMapModal();
  }

  private async applyLatLng(lat: number, lng: number): Promise<void> {
    try {
      const { Geocoder } = await google.maps.importLibrary('geocoding');
      const result = await new Geocoder().geocode({ location: { lat, lng } });
      if (result.results?.length) {
        const r = result.results[0];
        const get = (type: string) =>
          r.address_components.find((c: any) => c.types.includes(type))?.long_name || '';
        const parts = r.formatted_address.split(', ');
        this.formData.address = parts.length > 3 ? parts.slice(0, -3).join(', ') : r.formatted_address;
        this.formData.city = get('locality') || get('administrative_area_level_2');
        this.formData.state = get('administrative_area_level_1');
        this.formData.zip = get('postal_code');
        this.formData.latitude = lat;
        this.formData.longitude = lng;
        this.selectedSavedAddressId.set(null);
        this.refreshDeliveryFee();
      }
    } catch (e) { console.error('Reverse geocode error:', e); }
  }

  // ── Saved addresses (quick-select instead of retyping every order) ──────
  savedAddresses = signal<SavedAddress[]>([]);
  selectedSavedAddressId = signal<string | null>(null);
  showManualAddressForm = signal(false);

  selectSavedAddress(a: SavedAddress): void {
    this.selectedSavedAddressId.set(a.id);
    this.formData.address = a.address;
    if (a.city) this.formData.city = a.city;
    if (a.state) this.formData.state = a.state;
    if (a.pincode) this.formData.zip = a.pincode;
    this.formData.latitude = a.latitude;
    this.formData.longitude = a.longitude;
    this.showManualAddressForm.set(false);
    this.refreshDeliveryFee();
  }

  useNewAddress(): void {
    this.selectedSavedAddressId.set(null);
    this.showManualAddressForm.set(true);
  }

  // ── Distance-based delivery fee ─────────────────────────────────────────
  // Starts at the same flat fallback the backend uses when it can't compute
  // a real distance (e.g. the shopper types their address instead of using
  // the map picker) — never silently ₹0 before a location is picked.
  deliveryFee = signal<number>(49);
  deliveryFeeBreakdown = signal<{ shop_name: string; distance_km: number; fee: number }[]>([]);
  freeDeliveryApplied = signal(false);
  loadingDeliveryFee = signal(false);
  // Rapidly switching saved addresses (or editing the pin then immediately
  // picking a saved address) fired overlapping requests with no
  // cancellation — if an earlier request resolved after a later one, the
  // displayed fee/breakdown reverted to match an address the customer was
  // no longer using. Only the response matching the latest call is applied.
  private deliveryFeeRequestId = 0;

  refreshDeliveryFee(): void {
    if (this.formData.latitude == null || this.formData.longitude == null) return;
    this.loadingDeliveryFee.set(true);
    const requestId = ++this.deliveryFeeRequestId;
    const body = {
      items: this.cartService.getCartItems().map(item => ({
        productId: item.product.id, quantity: item.quantity, price: item.product.final_price ?? item.product.price,
      })),
      latitude: this.formData.latitude,
      longitude: this.formData.longitude,
    };
    this.http.post<{ delivery_fee: number; per_km_rate: number | null; breakdown: any[]; free_delivery: boolean }>(`${environment.apiUrl}/api/checkout/delivery-estimate`, body).subscribe({
      next: (res) => {
        if (requestId !== this.deliveryFeeRequestId) return;
        this.deliveryFee.set(res.delivery_fee);
        this.deliveryFeeBreakdown.set(res.breakdown || []);
        this.freeDeliveryApplied.set(res.free_delivery);
        this.loadingDeliveryFee.set(false);
        this.errorMessage.set('');
      },
      error: (err) => {
        if (requestId !== this.deliveryFeeRequestId) return;
        this.loadingDeliveryFee.set(false);
        if (err?.status === 409) {
          this.errorMessage.set(err?.error?.detail ?? 'One or more items in your cart are no longer available for delivery. Please remove them from your cart.');
        }
      },
    });
  }

  addressSuggestions = signal<AddressSuggestion[]>([]);
  showAddressSuggestions = signal(false);
  addressSearching = signal(false);
  private addressDebounce: ReturnType<typeof setTimeout> | null = null;

  // ── "Use my location" ───────────────────────────────────────────────────
  locatingAddress = signal(false);
  locatingError = signal('');

  // ── "Pin on map" modal ──────────────────────────────────────────────────
  showMapModal = signal(false);
  mapPinAddress = signal('');
  mapPinResolving = signal(false);
  @ViewChild('modalMapEl') modalMapEl!: ElementRef<HTMLDivElement>;
  private modalMap: any = null;
  private modalMarker: any = null;

  formData = {
    firstName: '',
    lastName: '',
    email: '',
    phone: '',
    address: '',
    apt: '',
    city: '',
    state: '',
    zip: '',
    latitude: null as number | null,
    longitude: null as number | null,
    cardName: '',
    cardNumber: '',
    expiry: '',
    cvv: '',
    upiId: '',
    giftMessage: '',
    deliveryDate: '',
    deliveryTime: ''
  };

  constructor(
    public cartService: CartService,
    public authService: AuthService,
    private http: HttpClient,
    private geocodeService: GeocodeService,
    private router: Router,
    private scroller: ViewportScroller,
    private confetti: ConfettiService,
    private loyaltyService: LoyaltyService,
    private promoService: PromoService,
    private addressesService: AddressesService
  ) {
    // Only bounce to /cart once the cart has actually finished loading —
    // cartCount() is legitimately 0 for a moment on a fresh page load
    // while the server cart is still in flight; checking synchronously
    // here used to wrongly redirect a logged-in user who really did have
    // items, on a refresh or a direct link into /checkout.
    effect(() => {
      if (this.cartService.loaded() && this.cartService.cartCount() === 0) {
        this.router.navigate(['/cart']);
      }
    });

    // Pre-fill name and email from logged-in user
    const user = this.authService.user();
    if (user) {
      this.formData.firstName = user.firstName;
      this.formData.lastName = user.lastName;
      this.formData.email = user.email;

      this.loyaltyService.getAccount(user.email, this.authService.getToken()).subscribe({
        next: data => this.loyaltyBalance.set(data.points_balance),
        error: () => {}
      });
      this.loyaltyService.getConfig().subscribe({
        next: cfg => this.redemptionRate.set(cfg.redemption_rate),
        error: () => {},
      });

      this.addressesService.list().subscribe({
        next: (addrs) => {
          this.savedAddresses.set(addrs);
          const def = addrs.find(a => a.is_default) || addrs[0];
          if (def) this.selectSavedAddress(def);
        },
        error: () => {},
      });
    }

    this.http.get<{ enabled: boolean; rate: number }>(`${environment.apiUrl}/api/tax-config`).subscribe({
      next: (cfg) => this.taxConfig.set(cfg),
      error: () => {},
    });

    // Load the live promo codes so the user can pick an eligible one here
    this.promoService.getOffers(user?.email).subscribe({
      next: d => this.availableOffers.set(d.seasonal_offers || []),
      error: () => {}
    });

    // Auto-apply pending promo from sessionStorage (e.g. set by bundle flow)
    const pending = sessionStorage.getItem('viva_promo');
    if (pending) {
      this.promoCode.set(pending);
      sessionStorage.removeItem('viva_promo');
      setTimeout(() => this.applyPromo(), 100);
    }
  }

  // ── Available offer picker ──────────────────────────────────────────────────
  offerDiscountLabel(o: SeasonalOffer): string {
    if (o.discount_type === 'percent' && o.discount_value != null) return `${o.discount_value}% OFF`;
    if (o.discount_type === 'flat' && o.discount_value != null) return `₹${o.discount_value} OFF`;
    return 'Deal';
  }
  offerCondition(o: SeasonalOffer): string {
    if (o.first_order_only) return 'First order only';
    if (o.min_order && o.min_order > 0) return `Min ₹${o.min_order}`;
    return 'No minimum';
  }
  private preDiscountTotal(): number {
    return this.cartService.cartTotal() + this.getShipping() - this.pointsDiscountAmount();
  }
  offerEligible(o: SeasonalOffer): boolean {
    return this.preDiscountTotal() >= (o.min_order || 0);
  }
  amountToUnlock(o: SeasonalOffer): number {
    return Math.max(0, (o.min_order || 0) - this.preDiscountTotal());
  }
  selectOffer(o: SeasonalOffer): void {
    this.promoCode.set(o.code);
    this.applyPromo();
  }

  getShipping(): number {
    return this.deliveryFee();
  }

  taxConfig = signal<{ enabled: boolean; rate: number }>({ enabled: false, rate: 0 });

  getTax(): number {
    if (!this.taxConfig().enabled || !this.taxConfig().rate) return 0;
    return +(this.cartService.cartTotal() * this.taxConfig().rate / 100).toFixed(2);
  }

  getTotal(): number {
    return Math.max(0, this.cartService.cartTotal() + this.getShipping() + this.getTax() - this.pointsDiscountAmount() - this.promoDiscountAmount());
  }

  applyPromo(): void {
    const code = this.promoCode().trim();
    if (!code) return;
    this.promoLoading.set(true);
    this.promoError.set('');
    this.promoResult.set(null);
    const preDiscountTotal = this.cartService.cartTotal() + this.getShipping() - this.pointsDiscountAmount();
    const user = this.authService.user();
    this.promoService.validateCode(code, preDiscountTotal, user?.email).subscribe({
      next: (result) => {
        this.promoLoading.set(false);
        this.promoResult.set(result);
      },
      error: (err) => {
        this.promoLoading.set(false);
        this.promoError.set(err?.error?.detail ?? 'Invalid promo code');
      }
    });
  }

  clearPromo(): void {
    this.promoCode.set('');
    this.promoResult.set(null);
    this.promoError.set('');
  }

  get maxRedeemable(): number {
    // Previously just the raw balance — a customer could redeem far more
    // points than a cheap order was even worth, driving getTotal() negative.
    // Cap it to however many points cover the order (after promo, before
    // points) and no further.
    const orderValueBeforePoints = Math.max(0, this.cartService.cartTotal() + this.getShipping() + this.getTax() - this.promoDiscountAmount());
    const maxPointsForOrderValue = Math.floor(orderValueBeforePoints * this.redemptionRate());
    return Math.min(this.loyaltyBalance(), maxPointsForOrderValue);
  }

  // A percent-type promo's discount is computed against (subtotal + shipping
  // − points discount) at the moment it's applied — if points redemption
  // changes afterward, that stored discount_amount went stale relative to
  // the new pre-discount total unless re-validated.
  private reapplyPromoIfApplied(): void {
    if (this.promoResult() && this.promoCode().trim()) {
      this.applyPromo();
    }
  }

  clampAndSetPoints(value: number): void {
    this.pointsToRedeem.set(Math.min(this.maxRedeemable, Math.max(0, value)));
    this.reapplyPromoIfApplied();
  }

  togglePoints(): void {
    this.loyaltyEnabled.set(!this.loyaltyEnabled());
    if (!this.loyaltyEnabled()) {
      this.pointsToRedeem.set(0);
    } else {
      this.pointsToRedeem.set(this.maxRedeemable);
    }
    this.reapplyPromoIfApplied();
  }

  @ViewChild('checkoutForm') checkoutForm?: NgForm;

  placeOrder(): void {
    // If required fields are missing, highlight them instead of silently doing nothing.
    if (this.checkoutForm && this.checkoutForm.invalid) {
      Object.values(this.checkoutForm.controls).forEach(c => c.markAsTouched());
      this.errorMessage.set('Please complete all required fields highlighted above (including payment details).');
      const firstInvalid = document.querySelector('.checkout-form .ng-invalid') as HTMLElement | null;
      firstInvalid?.scrollIntoView({ behavior: 'smooth', block: 'center' });
      return;
    }

    this.loading.set(true);
    this.errorMessage.set('');

    // Always use logged-in user's email if available
    const user = this.authService.user();
    const customerEmail = user ? user.email : this.formData.email;

    const deliveryDatetime = this.deliveryType() === 'scheduled' && this.formData.deliveryDate && this.formData.deliveryTime
      ? `${this.formData.deliveryDate}T${this.formData.deliveryTime}`
      : null;

    const payload = {
      items: this.cartService.getCartItems().map(item => ({
        productId: item.product.id,
        name: item.product.name,
        price: item.product.final_price ?? item.product.price,
        quantity: item.quantity
      })),
      total: this.getTotal(),
      customer: {
        name: `${this.formData.firstName} ${this.formData.lastName}`.trim(),
        email: customerEmail,
        phone: this.formData.phone,
        address: this.formData.apt
          ? `${this.formData.address}, ${this.formData.apt}`
          : this.formData.address,
        city: this.formData.city,
        state: this.formData.state,
        zip: this.formData.zip,
        latitude: this.formData.latitude,
        longitude: this.formData.longitude
      },
      delivery_type: this.deliveryType(),
      delivery_datetime: deliveryDatetime,
      points_redeemed: this.loyaltyEnabled() ? this.pointsToRedeem() : 0,
      promo_code: this.promoResult()?.code ?? undefined,
      is_recurring: this.isRecurring(),
      recurrence_type: this.isRecurring() ? 'annual' : null,
      payment_method: this.paymentMethod(),
      token: this.authService.getToken() || undefined,
      gift_message: this.formData.giftMessage?.trim() || undefined,
    };

    this.http.post<{ orderId: string; status: string; points_pending?: number; new_balance?: number }>(`${environment.apiUrl}/api/orders`, payload).subscribe({
      next: (res) => {
        this.loading.set(false);
        this.orderNumber.set(res.orderId);
        this.pointsEarned.set(res.points_pending ?? 0);
        this.newLoyaltyBalance.set(res.new_balance ?? 0);
        this.orderPlaced.set(true);
        this.cartService.clearCart();
        this.scroller.scrollToPosition([0, 0]);
        setTimeout(() => this.confetti.burst(), 300);
      },
      error: (err) => {
        this.loading.set(false);
        console.error('Order error:', err);
        this.errorMessage.set(err?.error?.detail ?? err?.message ?? 'Something went wrong. Please try again.');
      }
    });
  }
}
