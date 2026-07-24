import { Component, OnInit, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import { FormsModule } from '@angular/forms';
import { AddressesService, SavedAddress } from '../../services/addresses';
import { ToastService } from '../../services/toast';
import { ConfirmService } from '../../services/confirm';
import { LocationPicker, PickedLocation } from '../location-picker/location-picker';

@Component({
  selector: 'app-account-addresses',
  imports: [RouterLink, FormsModule, LocationPicker],
  templateUrl: './account-addresses.html',
  styleUrl: './account-addresses.scss'
})
export class AccountAddresses implements OnInit {
  addresses = signal<SavedAddress[]>([]);
  loading = signal(true);
  showForm = signal(false);
  editingId = signal<string | null>(null);
  saving = signal(false);
  deletingId = signal<string | null>(null);

  form = {
    label: 'Home',
    address: '',
    city: '' as string | null,
    state: '' as string | null,
    pincode: '' as string | null,
    latitude: null as number | null,
    longitude: null as number | null,
    is_default: false,
  };

  constructor(
    private addressesService: AddressesService,
    private toastService: ToastService,
    private confirmService: ConfirmService
  ) {}

  ngOnInit(): void {
    this.load();
  }

  load(): void {
    this.loading.set(true);
    this.addressesService.list().subscribe({
      next: (data) => { this.addresses.set(data); this.loading.set(false); },
      error: () => { this.loading.set(false); }
    });
  }

  onLocationPicked(loc: PickedLocation): void {
    this.form.latitude = loc.latitude;
    this.form.longitude = loc.longitude;
    if (loc.address) this.form.address = loc.address;
    if (loc.city) this.form.city = loc.city;
    if (loc.state) this.form.state = loc.state;
    if (loc.pincode) this.form.pincode = loc.pincode;
  }

  openAdd(): void {
    this.editingId.set(null);
    this.form = { label: 'Home', address: '', city: '', state: '', pincode: '', latitude: null, longitude: null, is_default: this.addresses().length === 0 };
    this.showForm.set(true);
  }

  openEdit(a: SavedAddress): void {
    this.editingId.set(a.id);
    this.form = {
      label: a.label, address: a.address, city: a.city, state: a.state, pincode: a.pincode,
      latitude: a.latitude, longitude: a.longitude, is_default: a.is_default,
    };
    this.showForm.set(true);
  }

  closeForm(): void {
    this.showForm.set(false);
    this.editingId.set(null);
  }

  save(): void {
    if (!this.form.address.trim()) {
      this.toastService.show('Please enter or pick a delivery address', 'error');
      return;
    }
    this.saving.set(true);
    const id = this.editingId();
    const req$ = id ? this.addressesService.update(id, this.form) : this.addressesService.create(this.form);
    req$.subscribe({
      next: () => {
        this.saving.set(false);
        this.toastService.show(id ? 'Address updated' : 'Address saved');
        this.closeForm();
        this.load();
      },
      error: (err) => {
        this.saving.set(false);
        this.toastService.show(err.error?.detail || 'Failed to save address', 'error');
      }
    });
  }

  async remove(a: SavedAddress): Promise<void> {
    const res = await this.confirmService.ask({
      title: 'Remove this address?',
      message: `"${a.label}" will be removed from your saved addresses.`,
      confirmText: 'Remove',
      danger: true,
    });
    if (!res) return;
    this.deletingId.set(a.id);
    this.addressesService.remove(a.id).subscribe({
      next: () => {
        this.deletingId.set(null);
        this.toastService.show('Address removed');
        this.load();
      },
      error: (err) => {
        this.deletingId.set(null);
        this.toastService.show(err.error?.detail || 'Failed to remove address', 'error');
      }
    });
  }

  makeDefault(a: SavedAddress): void {
    if (a.is_default) return;
    this.addressesService.update(a.id, { is_default: true }).subscribe({
      next: () => { this.toastService.show(`${a.label} set as default`); this.load(); },
      error: (err) => this.toastService.show(err.error?.detail || 'Failed to update', 'error')
    });
  }
}
