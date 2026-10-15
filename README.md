# Smart Trip Capture ✈️🚗🚆🚌

**Smart Trip Capture** is an intelligent, offline-first Progressive Web Application (PWA) designed for modern travelers, road trippers, and daily commuters. It captures itineraries, calculates multi-modal routes (with alternatives and travel-mode adjustments), manages intermediate waypoints, tracks expenses in real time in INR (₹), stores photos without storage limits, and supports local user accounts.

Built with **pure Vanilla JavaScript, modern Glassmorphic CSS, and Leaflet**, without heavy framework bloat.

---

## ✨ Features & Architecture Highlights

### 1. User Accounts & Offline Authentication
- **Local Account Creation & Sign In**: Users can register and sign in offline using native IndexedDB storage.
- **Client-Side Cryptographic Password Hashing**: Passwords are securely hashed using Web Crypto API (`SHA-256`) with salted keys.
- **Custom Traveler Avatars**: Choose from travel-themed avatars (✈️, 🧳, 🗺️, 🏕️, 🚗, 🛳️, 🧗, 🎒, etc.).
- **User Profile & Trip Statistics**: Live aggregates of total adventures planned, total distance traveled, and total expenditure.
- **Trip Isolation**: Trips are associated with the authenticated account (`trip.userId`).

### 2. High-Capacity IndexedDB Storage (No 5 MB localStorage Limit)
- Replaces brittle `localStorage` with `SmartTripDB` (IndexedDB v2) featuring four stores:
  - `trips`: Stores itineraries, waypoints, routes, expenses, and Blob photo arrays.
  - `feedback`: Stores user reviews and feature requests.
  - `users`: Stores user accounts and profile credentials.
  - `session`: Stores active user session tokens.

### 3. Smart Photo Optimization & Canvas Resizing
- Image uploads are dynamically scaled down to ~1024px JPEG using an offscreen HTML5 Canvas.
- Stored directly as binary `Blob` objects in IndexedDB.
- Rendered safely with `URL.createObjectURL()`, immediately revoked upon load to eliminate memory leaks.

### 4. Intelligent Geocoding & GPS Location Capture
- **GPS Integration**: Dedicated GPS buttons trigger `navigator.geolocation` only on explicit click with reverse-geocoding via OpenStreetMap Nominatim.
- **Debounced Search**: Nominatim address queries are debounced to >1 second to respect rate limits.
- **Autocomplete Dropdown**: Instant address suggestions with coordinates.
- **Geocode on Blur**: Manual typing triggers geocode verification on blur.

### 5. Multi-Modal Leaflet Map & OSRM Routing
- **Leaflet Integration**: Uses CartoDB Voyager and OSM tiles.
- **Alternative Routes**: Requests OSRM with `alternatives=true`, sorts alternatives by duration, and renders them with interactive selection pills.
- **Travel Mode Adjustments**:
  - 🚗 **Driving**: Exact OSRM road geometry, distance, and duration.
  - 🚌 **Bus**: Road duration factored by `× 1.3`.
  - 🚆 **Train**: Calculated duration based on `Distance ÷ 60 km/h`.
  - ✈️ **Flight**: Direct geodesic curved flight arc rendered with calculated duration `Distance ÷ 700 km/h + 2 hrs buffer`.
- **Fault-Tolerant Fallback**: Geodesic straight-line Haversine fallback when offline or if routing servers are unavailable.

### 6. Intermediate Stops & Waypoints
- Add multiple detours and stops.
- Each stop includes its own location search, GPS capture, notes, photos, and itemized expenses.
- Visual warning badges if coordinates are missing, ensuring no stop is silently dropped.

### 7. Live Indian Rupee (₹) Expense Calculation
- Itemized trip-level expenses (Fuel, Tolls, Hotels, Food) and stop-level expenses.
- Real-time live computed sum formatted with Indian number formatting (e.g. `₹ 12,450`).

### 8. Trip Records, Search, Export & Import
- Live search filtering by name, destination, stops, and notes.
- Filtering by travel mode and sorting by date, expenses, or distance.
- Detailed modal overview with itinerary breakdown, stop details, and photo gallery.
- Edit trips without losing existing photos.
- **JSON Export / Import**: Converts binary Blobs to Base64 for JSON export and seamlessly restores Base64 to Blobs on import.

### 9. Feedback & Contact
- 5-Star rating system, category pills (Bug, Idea, Other), and message length counter.
- Saves feedback to IndexedDB and opens prefilled `mailto:mdanishb03@gmail.com` with URI-encoded parameters.
- Direct developer contact links:
  - Phone: `+91 9270103581`
  - Email: `mdanishb03@gmail.com`

### 10. Progressive Web App (PWA)
- `manifest.json` configured with high-res 192px and 512px icons.
- `sw.js` service worker utilizing cache-first strategy for the app shell and fonts, with network-only handling for live map tiles and routing.

---

## 🚀 How to Run Locally

You can run Smart Trip locally using any web server:

```bash
# Option 1: Using Node npx
npx serve .

# Option 2: Using Python (Bypassing sandbox if running in restricted environments)
python3 -m http.server 8080

# Option 3: Direct browser opening
Open index.html directly in Google Chrome, Safari, or Microsoft Edge.
```

Visit `http://localhost:8080` (or the port indicated by your server).
