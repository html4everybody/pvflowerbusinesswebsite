import { Component, OnInit, signal, computed } from '@angular/core';
import { Router, RouterLink } from '@angular/router';
import { FormsModule } from '@angular/forms';
import { HttpClient } from '@angular/common/http';
import { AuthService } from '../../services/auth';
import { CartService } from '../../services/cart';
import { ProductService } from '../../services/product';
import { ToastService } from '../../services/toast';
import { environment } from '../../../environments/environment';

export interface OccasionReminder {
  id: string;
  user_email: string;
  title: string;
  occasion_type: string;
  month: number;
  day: number;
  linked_order_id?: string;
  notes?: string;
  created_at: string;
}

const OCCASION_TYPES = [
  { value: 'birthday',    label: 'Birthday',     emoji: '🎂' },
  { value: 'anniversary', label: 'Anniversary',  emoji: '💍' },
  { value: 'valentine',   label: "Valentine's",  emoji: '❤️' },
  { value: 'mothers_day', label: "Mother's Day", emoji: '🌷' },
  { value: 'fathers_day', label: "Father's Day", emoji: '👔' },
  { value: 'graduation',  label: 'Graduation',   emoji: '🎓' },
  { value: 'custom',      label: 'Custom',       emoji: '🎉' },
];

const MONTHS = [
  'January','February','March','April','May','June',
  'July','August','September','October','November','December'
];

@Component({
  selector: 'app-reminders',
  imports: [FormsModule, RouterLink],
  templateUrl: './reminders.html',
  styleUrl: './reminders.scss'
})
export class Reminders implements OnInit {
  occasions    = signal<OccasionReminder[]>([]);
  pastOrders   = signal<any[]>([]);
  showForm     = signal(false);
  editingId    = signal<string | null>(null);
  loading      = signal(false);
  saving       = signal(false);
  reordering   = signal<string | null>(null);
  deleteConfirm = signal<string | null>(null);

  formData = {
    title: '', occasion_type: 'birthday',
    month: 1, day: 1,
    linked_order_id: '', notes: ''
  };

  readonly occasionTypes = OCCASION_TYPES;
  readonly months = MONTHS;
  readonly days   = Array.from({ length: 31 }, (_, i) => i + 1);

  // Sorted by days-until (soonest first)
  sortedOccasions = computed(() =>
    [...this.occasions()].sort((a, b) =>
      this.getDaysUntil(a.month, a.day) - this.getDaysUntil(b.month, b.day)
    )
  );

  constructor(
    private authService: AuthService,
    private cartService: CartService,
    private productService: ProductService,
    private toastService: ToastService,
    private router: Router,
    private http: HttpClient
  ) {}

  ngOnInit(): void {
    if (!this.authService.user()) {
      this.router.navigate(['/signin']);
      return;
    }
    this.load();
    this.loadPastOrders();
  }

  private load(): void {
    this.loading.set(true);
    const email = this.authService.user().email;
    this.http.get<OccasionReminder[]>(`${environment.apiUrl}/api/occasions?email=${encodeURIComponent(email)}`).subscribe({
      next: (data) => { this.occasions.set(data); this.loading.set(false); },
      error: ()   => this.loading.set(false)
    });
  }

  private loadPastOrders(): void {
    const email = this.authService.user().email;
    this.http.get<any[]>(`${environment.apiUrl}/api/orders?email=${encodeURIComponent(email)}`).subscribe({
      next: (orders) => this.pastOrders.set(
        (orders || []).filter(o => o.status !== 'cancelled').slice(0, 20)
      ),
      error: () => {}
    });
  }

  // ── Date helpers ─────────────────────────────────────────────────────────────
  getDaysUntil(month: number, day: number): number {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const year = today.getFullYear();
    let next = new Date(year, month - 1, day);
    if (next <= today) next = new Date(year + 1, month - 1, day);
    return Math.ceil((next.getTime() - today.getTime()) / 86400000);
  }

  getUrgency(days: number): 'today' | 'urgent' | 'soon' | 'upcoming' {
    if (days === 0) return 'today';
    if (days <= 3)  return 'urgent';
    if (days <= 14) return 'soon';
    return 'upcoming';
  }

  getDaysLabel(days: number): string {
    if (days === 0) return 'Today! 🎉';
    if (days === 1) return 'Tomorrow';
    return `${days} days away`;
  }

  getEmoji(type: string): string {
    return OCCASION_TYPES.find(t => t.value === type)?.emoji ?? '🎉';
  }

  getTypeLabel(type: string): string {
    return OCCASION_TYPES.find(t => t.value === type)?.label ?? 'Custom';
  }

  getMonthName(month: number): string {
    return MONTHS[month - 1] ?? '';
  }

  formatOrderLabel(order: any): string {
    const date = order.created_at?.slice(0, 10) ?? '';
    const items = order.items?.map((i: any) => i.name).join(', ') ?? '';
    const preview = items.length > 40 ? items.slice(0, 40) + '…' : items;
    return `${order.id} · ${date}${preview ? ' — ' + preview : ''}`;
  }

  // ── Form ────────────────────────────────────────────────────────────────────
  openAdd(): void {
    this.editingId.set(null);
    this.formData = { title: '', occasion_type: 'birthday', month: 1, day: 1, linked_order_id: '', notes: '' };
    this.showForm.set(true);
  }

  openEdit(occ: OccasionReminder): void {
    this.editingId.set(occ.id);
    this.formData = {
      title: occ.title,
      occasion_type: occ.occasion_type,
      month: occ.month,
      day: occ.day,
      linked_order_id: occ.linked_order_id ?? '',
      notes: occ.notes ?? ''
    };
    this.showForm.set(true);
  }

  closeForm(): void {
    this.showForm.set(false);
    this.editingId.set(null);
  }

  save(): void {
    if (!this.formData.title.trim()) return;
    this.saving.set(true);
    const email = this.authService.user().email;
    const body = {
      user_email: email,
      title: this.formData.title.trim(),
      occasion_type: this.formData.occasion_type,
      month: this.formData.month,
      day: this.formData.day,
      linked_order_id: this.formData.linked_order_id || null,
      notes: this.formData.notes || null
    };

    const id = this.editingId();
    const req = id
      ? this.http.put<OccasionReminder>(`${environment.apiUrl}/api/occasions/${id}`, body)
      : this.http.post<OccasionReminder>(`${environment.apiUrl}/api/occasions`, body);

    req.subscribe({
      next: (saved) => {
        this.saving.set(false);
        if (id) {
          this.occasions.update(list => list.map(o => o.id === id ? saved : o));
        } else {
          this.occasions.update(list => [...list, saved]);
        }
        this.toastService.show(id ? 'Reminder updated!' : 'Reminder saved! 🌸');
        this.closeForm();
      },
      error: () => { this.saving.set(false); this.toastService.show('Failed to save. Please try again.', 'error'); }
    });
  }

  confirmDelete(id: string): void { this.deleteConfirm.set(id); }
  cancelDelete(): void             { this.deleteConfirm.set(null); }

  delete(id: string): void {
    this.http.delete(`${environment.apiUrl}/api/occasions/${id}`).subscribe({
      next: () => {
        this.occasions.update(list => list.filter(o => o.id !== id));
        this.deleteConfirm.set(null);
        this.toastService.show('Reminder deleted.');
      },
      error: () => this.toastService.show('Failed to delete.', 'error')
    });
  }

  // ── Re-order ────────────────────────────────────────────────────────────────
  reorder(orderId: string): void {
    this.reordering.set(orderId);
    this.http.get<any>(`${environment.apiUrl}/api/orders/${orderId}`).subscribe({
      next: (order) => {
        const items: any[] = order.items ?? [];
        let added = 0;
        for (const item of items) {
          const product = this.productService.getProductById(item.product_id);
          if (product) {
            this.cartService.addToCart(product, item.quantity);
            added++;
          }
        }
        this.reordering.set(null);
        if (added > 0) {
          this.toastService.show(`${added} item${added > 1 ? 's' : ''} added to cart! 🛒`);
          this.router.navigate(['/cart']);
        } else {
          this.toastService.show('Could not find products from that order.', 'error');
        }
      },
      error: () => { this.reordering.set(null); this.toastService.show('Failed to load order.', 'error'); }
    });
  }
}
