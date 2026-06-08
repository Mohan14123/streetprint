<div align="center">
  <img src="https://raw.githubusercontent.com/lucide-icons/lucide/main/icons/map-pinned.svg" alt="StreetPrint Logo" width="80" height="80">
  <h1 align="center">StreetPrint 📍</h1>
  <p align="center">
    <img src="https://github.com/Mohan14123/streetprint/actions/workflows/test.yml/badge.svg" alt="CI Status">
    <img src="https://img.shields.io/badge/coverage-85%25-brightgreen.svg" alt="Coverage">
  </p>
  <p align="center">
    <strong>My Geospatial Route Tracking Capstone Project!</strong>
  </p>
  <p align="center">
    A full-stack web application that records your movement through a city, generates beautiful heatmaps, and helps you discover unexplored areas.
  </p>
</div>

---

## 👋 Hey there!

Welcome to **StreetPrint**, my personal capstone project. I built this application to solve a problem I had: I wanted a way to track exactly which streets I've walked down in my city without relying on big tech tracking apps. It turned into a massive learning journey where I got to dive deep into geospatial databases, real-time frontend rendering, and resilient backend architectures.

I'm really proud of how it turned out, especially the custom theming system and the way it handles spotty GPS signals!

---

## 🧠 What I Learned

Building this project taught me a lot about full-stack development, especially handling edge cases:
- **Geospatial Queries**: I learned how to use MongoDB's `2dsphere` indexes to efficiently query nearby places and build bounding boxes for heatmaps.
- **Message Queues**: To prevent the backend from crashing when the phone sends tons of GPS coordinates, I learned how to implement a **Redis + Bull** queue to handle writes asynchronously.
- **GPS Noise Reduction**: Raw GPS data is messy. I implemented a **Kalman filter** on the frontend to smooth out the lines before displaying them.
- **Offline-First Resilience**: Mobile browsers lose connection all the time. I learned how to use **IndexedDB** and Service Workers to cache data locally and sync it when the internet comes back.
- **Authentication**: I built a complete JWT auth system from scratch, including access/refresh tokens, password resets, and email verification.

---

## ✨ Features I Built

- **📍 Real-time Tracking** — Records your live route with noise reduction. The route is progressively revealed as you walk, with colors changing based on your speed!
- **🎨 Dark/Light Theme System** — I built a custom CSS-variable based theming engine. You can toggle between dark and light modes, and even the underlying map tiles swap out seamlessly.
- **🔥 Movement Heatmaps** — Visualizes where you've been most frequently with dynamic intensity circles.
- **🗺️ Interactive Map & Search** — Search for places using Nominatim (OpenStreetMap), drop pins, and save them to your custom lists.
- **🔐 Secure Authentication** — Full user accounts with JWT sessions, password recovery, and email verification.
- **🛡️ Privacy First** — Includes GDPR-compliant endpoints to export all your personal data as a JSON file, or completely delete your account and all cascading data.
- **📱 Responsive UI** — Designed mobile-first with smooth framer-motion animations, glassmorphic UI elements, and bottom sheet menus.

---

## 🏗️ The Tech Stack

Here's what I used to put it all together:

| Part of the App | What I Used |
|-----------------|-------------|
| **Backend API** | Node.js, Express.js, TypeScript |
| **Database** | MongoDB 7 (for GeoJSON awesomeness) |
| **Caching & Queues**| Redis + Bull |
| **Frontend** | React 18, Vite, TypeScript |
| **Map Rendering** | Leaflet + React-Leaflet |
| **Styling** | Tailwind CSS + Framer Motion |
| **Offline Storage**| IndexedDB (localForage) |
| **Testing** | Jest + Supertest |

---

## 🚀 How to Run It Locally

If you want to try it out yourself, the easiest way is using Docker!

### Prerequisites
- Node.js (v20+)
- Docker & Docker Compose

### Step-by-Step

1. **Clone the repo**
   ```bash
   git clone https://github.com/Mohan14123/streetprint.git
   cd streetprint
   ```

2. **Set up environment variables**
   ```bash
   cp backend/.env.example backend/.env
   # Make sure to edit backend/.env and add secret keys for JWT_ACCESS_SECRET and JWT_REFRESH_SECRET!
   ```

3. **Spin it up!**
   ```bash
   docker-compose up --build
   ```

Once Docker finishes building, you can access the app at:
- **Frontend App**: `http://localhost:5173`
- **Backend API**: `http://localhost:3000`

### Running tests
I wrote tests for the backend to make sure everything stays stable. You can run them with:
```bash
cd backend
npm install
npm test
```

---

## 📝 Future Improvements (What's Next?)
Even though the core MVP is done, I still have ideas for the future:
- Implementing an ML algorithm (like DBSCAN) for smarter route suggestions.
- Adding social features to share routes with friends.
- Offline tile caching so the map works completely without internet.

Thanks for checking out my project! 🚀
