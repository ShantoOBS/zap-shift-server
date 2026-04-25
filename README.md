# Zap Shift — Parcel Logistics API

Backend REST API for **Zap Shift**, a parcel shipping and delivery management platform. Handles users, parcels, riders, payments, tracking, and admin analytics with role-based access and secure payment processing.

Live demo: https://zap-shift-server-a2s2.onrender.com/

---

## Table of Contents

- [Overview](#overview)
- [Tech Stack](#tech-stack)
- [Features](#features)
- [API Overview](#api-overview)
- [Getting Started](#getting-started)
- [Environment Variables](#environment-variables)
- [Project Structure](#project-structure)
- [License](#license)

---

## Overview

Zap Shift Server is a **Node.js** backend that powers:

- **Customers**: Create parcels, pay via Stripe, and track shipments.
- **Riders**: View assigned deliveries and update delivery status.
- **Admins**: Manage users, riders, parcels, and view dashboard analytics.

Authentication is handled via **Firebase Authentication** (JWT); data is stored in **MongoDB** and payments are processed through **Stripe**.

---

## Tech Stack

| Category        | Technology        | Purpose                                                |
|----------------|-------------------|--------------------------------------------------------|
| **Runtime**    | Node.js           | Server runtime                                         |
| **Framework**  | Express.js 5      | REST API, routing, middleware                          |
| **Database**   | MongoDB           | Users, parcels, riders, payments, tracking logs        |
| **Auth**       | Firebase Admin SDK| JWT verification, user identity                        |
| **Payments**   | Stripe            | Checkout sessions, one-time payments                   |
| **Security**   | CORS, JWT         | Cross-origin and authenticated access                  |
| **Config**     | dotenv            | Environment-based configuration                         |

---

## Features

### Authentication & Authorization

- **Firebase ID token verification** on protected routes.
- **Role-based access**: `admin`, `user`, `rider`.
- **Middleware**: `verifyToken` (authenticated user), `verifyAdmin` (admin-only).
- Email-scoped data so users only access their own payments and parcels.

### User Management

- **Register** users (stored with role `user`).
- **List** users with optional search by display name or email.
- **Get role** by email (for client-side role checks).
- **Update/delete** user roles (admin only).

### Parcel Management

- **Create** parcels with auto-generated tracking IDs (`PRCL-YYYYMMDD-XXXXXX`).
- **List** parcels with filters: sender email, delivery status.
- **Rider view**: parcels by rider email and delivery status (excluding delivered).
- **Update delivery status** (e.g. `pending-pickup`, `driver_assigned`, `parcel_delivered`) with tracking logs.
- **Assign rider** to parcel and set rider work status to `in_delivery`.
- **Edit** parcel (name, cost).
- **Delete** parcel.
- **Tracking**: every status change is logged with timestamp for audit and tracking UI.

### Rider Management

- **Register** riders (initial status `pending`).
- **List** riders with filters: status, district, work status.
- **Approve/reject** riders (admin); on approval, user role set to `rider`.
- **Update** rider status and work status (`available`, `in_delivery`).
- **Delete** riders (admin).

### Payments

- **Stripe Checkout**: create session from parcel cost, name, sender email, parcel ID, tracking ID.
- **Success handler**: mark parcel as paid, set `deliveryStatus` to `pending-pickup`, store payment record, avoid duplicate processing by transaction ID.
- **List payments** by customer email (authenticated, email must match token).

### Tracking & Logs

- **Get tracking logs** by `trackingId` (chronological).
- **Logged events**: parcel created, paid, driver assigned, status updates (e.g. delivered, damaged, delayed).

### Admin Dashboard

- **Overview**: counts for new packages, ready for shipping, completed deliveries, new clients.
- **Shipment stats**: parcel counts aggregated by day of week.
- **Shipping reports**: recent parcels with client display name (e.g. last 10).
- **Late invoices**: recent payments (e.g. last 5).
- **Shipment alerts**: recent damaged/delayed tracking entries (e.g. last 5).
- **Revenue**: total revenue from payments collection.

---

## API Overview

| Method | Endpoint | Auth | Description |
|--------|----------|------|-------------|
| **Dashboard** |
| GET | `/dashboard/overview` | — | Overview metrics |
| GET | `/dashboard/shipment-stats` | — | Shipments by day of week |
| GET | `/dashboard/shipping-reports` | — | Recent shipping reports |
| GET | `/dashboard/late-invoices` | — | Recent payments |
| GET | `/dashboard/shipment-alerts` | — | Damaged/delayed alerts |
| GET | `/dashboard/revenue` | — | Total revenue |
| **Users** |
| GET | `/users` | Token | List users (optional search) |
| GET | `/users/:email/role` | — | Get user role |
| POST | `/users` | — | Register user |
| PATCH | `/users/:id/role` | Token + Admin | Update role |
| DELETE | `/users/:id/role` | Token + Admin | Delete user |
| **Parcels** |
| POST | `/parcels` | — | Create parcel |
| GET | `/parcels` | — | List parcels (query: email, deliveryStatus) |
| GET | `/parcels/rider` | — | List parcels for rider (query: riderEmail, deliveryStatus) |
| PATCH | `/parcels/:id/status` | — | Update delivery status |
| PATCH | `/parcels/:id` | — | Assign rider |
| PATCH | `/parcels/update-parcel/:id` | — | Edit parcel (name, cost) |
| DELETE | `/parcels/:id` | — | Delete parcel |
| **Riders** |
| GET | `/riders` | — | List riders (query: status, district, workStatus) |
| POST | `/riders` | — | Register rider |
| PATCH | `/riders/:id` | Token | Update rider (e.g. approve, status) |
| DELETE | `/riders/:id` | Token | Delete rider |
| **Payments** |
| GET | `/payments` | Token | List payments (query: email) |
| POST | `/create-checkout-session` | — | Create Stripe Checkout session |
| PATCH | `/payment-success` | — | Handle successful payment (query: session_id) |
| **Tracking** |
| GET | `/trackings/:trackingId/logs` | — | Get tracking logs |
| **Health** |
| GET | `/` | — | Server health check |

---

## Getting Started

### Prerequisites

- **Node.js** (v18+ recommended)
- **MongoDB** (local or [MongoDB Atlas](https://www.mongodb.com/cloud/atlas))
- **Firebase** project with Authentication enabled
- **Stripe** account for payments

### Installation

```bash
# Clone the repository
git clone <repository-url>
cd zap-shift-server

# Install dependencies
npm install
```

### Environment Variables

Create a `.env` file in the project root (see [Environment Variables](#environment-variables) below).  
Add your Firebase service account JSON (e.g. from Firebase Console → Project Settings → Service Accounts) and reference it in code (e.g. `zap-shift.json` or via an env path). **Do not commit this file or any secrets.**

### Run

```bash
# Development (default port 3000)
node index.js

# Or with explicit port
PORT=4000 node index.js
```

The server will connect to MongoDB and listen on the configured port. Use `GET /` to confirm it is running.

---

## Environment Variables

| Variable | Required | Description |
|----------|----------|-------------|
| `PORT` | No | Server port (default: `3000`) |
| `DB_USER` | Yes | MongoDB Atlas username |
| `DB_PASSWORD` | Yes | MongoDB Atlas password |
| `STRIPE_KEY` | Yes | Stripe secret key (e.g. `sk_test_...` or `sk_live_...`) |
| `SITE_DOMAIN` | Yes | Frontend base URL for Stripe success/cancel redirects |

Firebase is configured via a service account JSON file (path used in code must match your setup). Keep this file and `.env` out of version control.

---

## Project Structure

```
zap-shift-server/
├── index.js          # Express app, MongoDB connection, routes, middleware
├── package.json      # Dependencies and scripts
├── .env              # Environment variables (create locally, do not commit)
├── zap-shift.json    # Firebase service account (do not commit)
└── README.md         # This file
```

- **index.js**: Single entrypoint — middleware (CORS, JSON, Firebase auth), MongoDB client and collections, all REST routes (dashboard, users, parcels, riders, payments, tracking), Stripe Checkout and payment-success logic, and server listen.

---

## License

ISC

---

For questions or contributions, open an issue or pull request in the repository.
