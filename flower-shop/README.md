# FloranFlowers 🌸

A full-stack flower shop e-commerce web application built with **Angular 21** (frontend) and **FastAPI** (backend), powered by **Supabase** (PostgreSQL).

---

## Project Structure

```
flower-shop/
├── frontend/   # Angular 21 app
└── backend/    # FastAPI (Python) server
```

---

## Prerequisites

- **Node.js** v18+ and **npm** v11+
- **Python** 3.10+
- A **Supabase** project (for database)

---

## Backend Setup (FastAPI)

### 1. Navigate to the backend folder

```bash
cd flower-shop/backend
```

### 2. Create and activate a virtual environment

```bash
python -m venv .venv

# Windows (PowerShell)
.venv\Scripts\Activate.ps1

# Mac / Linux
source .venv/bin/activate
```

### 3. Install dependencies

```bash
pip install -r requirements.txt
```

### 4. Create the `.env` file

Create a file named `.env` inside the `backend/` folder:

```env
SUPABASE_URL=your_supabase_project_url
SUPABASE_KEY=your_supabase_anon_key
```

> Get these values from your Supabase project → Settings → API.

### 5. Run the backend server

```bash
uvicorn main:app --reload --port 8000
```

- API runs at: `http://localhost:8000`
- Interactive API docs: `http://localhost:8000/docs`

---

## Frontend Setup (Angular)

### 1. Navigate to the frontend folder

```bash
cd flower-shop/frontend
```

### 2. Install dependencies

```bash
npm install
```

### 3. Run the development server

```bash
npm start
```

- App runs at: `http://localhost:4200`
- The dev server automatically proxies `/api` requests to `localhost:8000`

> **Note:** The backend must be running for product, cart, auth, and order features to work.

---

## Running Both Together

Open **two terminals** side by side:

**Terminal 1 — Backend**
```bash
cd flower-shop/backend
.venv\Scripts\Activate.ps1     # or: source .venv/bin/activate
uvicorn main:app --reload --port 8000
```

**Terminal 2 — Frontend**
```bash
cd flower-shop/frontend
npm start
```

Then open `http://localhost:4200` in your browser.

---

## Key Features

- Browse flowers by category (Bouquets, Garlands, Flower Braids, Decoration)
- User authentication (register / login)
- Cart — guest mode (localStorage) + logged-in mode (Supabase)
- Wishlist
- Custom Bouquet Builder
- Checkout with immediate or scheduled delivery
- Order history and cancellation
- Dark / Light mode toggle
- Contact form

---

## API Endpoints

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/products` | List products (optional `?category=`) |
| GET | `/api/products/:id` | Get single product |
| GET | `/api/products/categories` | List all categories |
| POST | `/api/auth/register` | Register user |
| POST | `/api/auth/login` | Login user |
| GET | `/api/cart?user_id=` | Get cart items |
| POST | `/api/cart/item` | Add item to cart |
| DELETE | `/api/cart/item/:id` | Remove cart item |
| DELETE | `/api/cart/clear` | Clear cart |
| GET | `/api/orders?email=` | Get orders by email |
| POST | `/api/orders` | Place order |
| PATCH | `/api/orders/:id/cancel` | Cancel order |
| POST | `/api/contact` | Submit contact form |
