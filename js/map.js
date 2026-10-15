/**
 * SmartTrip Leaflet Map & Routing Module
 * Handles map rendering, custom markers, OSRM API routing with alternatives,
 * travel mode adjustments (Bus x1.3, Train 60km/h, Flight 700km/h + 2h),
 * and geodesic straight/arc line fallbacks.
 */

class SmartTripMap {
  constructor(containerId = 'map') {
    this.containerId = containerId;
    this.map = null;
    this.markersGroup = null;
    this.routesGroup = null;
    this.selectedRouteIndex = 0;
    this.routesData = [];
    this.currentMode = 'driving';
    this.onRouteCalculated = null; // Callback for app UI
  }

  init() {
    if (this.map) return;

    // Default center on Mumbai / India, or can be dynamic
    this.map = L.map(this.containerId, {
      zoomControl: true,
      attributionControl: false
    }).setView([19.0760, 72.8777], 6);

    // High performance CartoDB Voyager / OSM tile layer
    L.tileLayer('https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png', {
      maxZoom: 19,
      subdomains: 'abcd'
    }).addTo(this.map);

    // Add clean minimal attribution
    L.control.attribution({ position: 'bottomright' })
      .addAttribution('&copy; <a href="https://carto.com/">CARTO</a> &copy; <a href="https://www.openstreetmap.org/copyright">OSM</a>')
      .addTo(this.map);

    this.markersGroup = L.featureGroup().addTo(this.map);
    this.routesGroup = L.featureGroup().addTo(this.map);
  }

  // Create custom SVG markers
  createMarkerIcon(type, number = null) {
    let bgColor = '#6366f1'; // indigo
    let label = '';

    if (type === 'start') {
      bgColor = '#10b981'; // emerald green
      label = 'A';
    } else if (type === 'dest') {
      bgColor = '#f43f5e'; // rose/red
      label = 'B';
    } else if (type === 'stop') {
      bgColor = '#f59e0b'; // amber
      label = number ? String(number) : 'S';
    }

    const html = `
      <div class="custom-map-pin" style="background-color: ${bgColor};">
        <span class="pin-label">${label}</span>
      </div>
    `;

    return L.divIcon({
      html: html,
      className: 'custom-pin-container',
      iconSize: [32, 32],
      iconAnchor: [16, 32],
      popupAnchor: [0, -30]
    });
  }

  // Update all markers on the map
  updateMarkers(start, stops = [], dest) {
    if (!this.map) this.init();
    this.markersGroup.clearLayers();

    if (start && start.lat && start.lng) {
      const startMarker = L.marker([start.lat, start.lng], {
        icon: this.createMarkerIcon('start')
      }).bindPopup(`<strong>Origin:</strong> ${window.AppUtils.esc(start.label || 'Start')}`);
      this.markersGroup.addLayer(startMarker);
    }

    stops.forEach((stop, index) => {
      if (stop && stop.lat && stop.lng) {
        const stopMarker = L.marker([stop.lat, stop.lng], {
          icon: this.createMarkerIcon('stop', index + 1)
        }).bindPopup(`<strong>Stop ${index + 1}:</strong> ${window.AppUtils.esc(stop.name || 'Stop')}`);
        this.markersGroup.addLayer(stopMarker);
      }
    });

    if (dest && dest.lat && dest.lng) {
      const destMarker = L.marker([dest.lat, dest.lng], {
        icon: this.createMarkerIcon('dest')
      }).bindPopup(`<strong>Destination:</strong> ${window.AppUtils.esc(dest.label || 'Destination')}`);
      this.markersGroup.addLayer(destMarker);
    }

    // Zoom to fit all markers if present and no active route lines yet
    if (this.markersGroup.getLayers().length > 0 && this.routesGroup.getLayers().length === 0) {
      this.map.fitBounds(this.markersGroup.getBounds(), { padding: [40, 40], maxZoom: 14 });
    }
  }

  /**
   * Calculate route given start, stops, and dest
   * Supports Driving, Bus, Train, Flight
   */
  async calculateRoute(start, stops = [], dest, mode = 'driving') {
    if (!this.map) this.init();
    this.currentMode = mode;
    this.routesGroup.clearLayers();
    this.routesData = [];

    // Verify coordinates
    const validWaypoints = [];
    if (start && start.lat && start.lng) validWaypoints.push(start);
    stops.forEach((s) => {
      if (s && s.lat && s.lng) validWaypoints.push(s);
    });
    if (dest && dest.lat && dest.lng) validWaypoints.push(dest);

    this.updateMarkers(start, stops, dest);

    if (validWaypoints.length < 2) {
      return null;
    }

    // Flight mode: straight line or curved geodesic flight arc
    if (mode === 'flight') {
      return this.renderFlightRoute(validWaypoints);
    }

    // Road / Rail routes: Query OSRM with alternatives=true
    try {
      const coordsString = validWaypoints
        .map((pt) => `${pt.lng},${pt.lat}`)
        .join(';');

      const osrmUrl = `https://router.project-osrm.org/route/v1/driving/${coordsString}?overview=full&geometries=geojson&alternatives=true`;
      
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 6000); // 6s timeout

      const response = await fetch(osrmUrl, { signal: controller.signal });
      clearTimeout(timeoutId);

      if (!response.ok) {
        throw new Error(`OSRM status ${response.status}`);
      }

      const data = await response.json();
      if (!data.routes || data.routes.length === 0) {
        throw new Error('No routes returned from OSRM');
      }

      // Sort routes by duration ascending
      const rawRoutes = data.routes.sort((a, b) => a.duration - b.duration);

      // Apply mode adjustments
      this.routesData = rawRoutes.map((r, index) => {
        let adjustedDuration = r.duration;
        let adjustedDistance = r.distance; // in meters

        if (mode === 'bus') {
          // Bus factor: road time x 1.3
          adjustedDuration = r.duration * 1.3;
        } else if (mode === 'train') {
          // Train: distance / 60 km/h
          const distKm = r.distance / 1000;
          adjustedDuration = (distKm / 60) * 3600;
        }

        return {
          id: index,
          distance: adjustedDistance,
          duration: adjustedDuration,
          originalDuration: r.duration,
          geometry: r.geometry,
          mode: mode,
          summary: r.legs ? r.legs.map((l) => l.summary).filter(Boolean).join(', ') : ''
        };
      });

      this.selectedRouteIndex = 0;
      this.renderRoutesOnMap();

      if (this.onRouteCalculated) {
        this.onRouteCalculated(this.routesData, this.selectedRouteIndex);
      }

      return this.routesData[0];
    } catch (err) {
      console.warn('OSRM routing request failed or timed out. Falling back to straight haversine route:', err);
      return this.renderFallbackRoute(validWaypoints, mode);
    }
  }

  // Fallback Haversine straight line route when offline or OSRM unavailable
  renderFallbackRoute(waypoints, mode) {
    let totalDistKm = 0;
    const latLngs = [];

    for (let i = 0; i < waypoints.length; i++) {
      latLngs.push([waypoints[i].lat, waypoints[i].lng]);
      if (i > 0) {
        totalDistKm += window.AppUtils.haversineDistanceKm(
          waypoints[i - 1].lat,
          waypoints[i - 1].lng,
          waypoints[i].lat,
          waypoints[i].lng
        );
      }
    }

    const totalDistMeters = totalDistKm * 1000;
    let durationSeconds = 0;

    if (mode === 'flight') {
      durationSeconds = (totalDistKm / 700 + 2) * 3600;
    } else if (mode === 'bus') {
      durationSeconds = (totalDistKm / 45) * 3600;
    } else if (mode === 'train') {
      durationSeconds = (totalDistKm / 60) * 3600;
    } else {
      // driving fallback (avg 60 km/h)
      durationSeconds = (totalDistKm / 60) * 3600;
    }

    const fallbackRoute = {
      id: 0,
      distance: totalDistMeters,
      duration: durationSeconds,
      geometry: {
        type: 'LineString',
        coordinates: waypoints.map((pt) => [pt.lng, pt.lat])
      },
      mode: mode,
      isFallback: true,
      summary: 'Direct geodesic path (Offline/Fallback)'
    };

    this.routesData = [fallbackRoute];
    this.selectedRouteIndex = 0;

    // Draw straight dashed polyline
    const polyline = L.polyline(latLngs, {
      color: '#6366f1',
      weight: 4,
      dashArray: '8, 8',
      opacity: 0.85
    }).addTo(this.routesGroup);

    this.map.fitBounds(polyline.getBounds(), { padding: [40, 40] });

    if (this.onRouteCalculated) {
      this.onRouteCalculated(this.routesData, 0);
    }

    return fallbackRoute;
  }

  // Render Flight Route with smooth curved geodesic arcs
  renderFlightRoute(waypoints) {
    let totalDistKm = 0;
    const allArcPoints = [];

    for (let i = 0; i < waypoints.length - 1; i++) {
      const segDist = window.AppUtils.haversineDistanceKm(
        waypoints[i].lat,
        waypoints[i].lng,
        waypoints[i + 1].lat,
        waypoints[i + 1].lng
      );
      totalDistKm += segDist;

      const segPoints = window.AppUtils.generateFlightArc(waypoints[i], waypoints[i + 1], 40);
      allArcPoints.push(...segPoints);
    }

    const totalDistMeters = totalDistKm * 1000;
    // Flight duration: distance ÷ 700 km/h + 2 h
    const durationSeconds = (totalDistKm / 700 + 2) * 3600;

    const flightRoute = {
      id: 0,
      distance: totalDistMeters,
      duration: durationSeconds,
      geometry: {
        type: 'LineString',
        coordinates: allArcPoints.map(([lat, lng]) => [lng, lat])
      },
      mode: 'flight',
      summary: 'Great Circle Flight Corridor'
    };

    this.routesData = [flightRoute];
    this.selectedRouteIndex = 0;

    // Draw glowing flight arc
    // Background glow
    L.polyline(allArcPoints, {
      color: '#38bdf8',
      weight: 8,
      opacity: 0.35
    }).addTo(this.routesGroup);

    // Foreground dashed flight line
    const flightLine = L.polyline(allArcPoints, {
      color: '#0284c7',
      weight: 3.5,
      dashArray: '6, 6',
      opacity: 0.95
    }).addTo(this.routesGroup);

    this.map.fitBounds(flightLine.getBounds(), { padding: [40, 40] });

    if (this.onRouteCalculated) {
      this.onRouteCalculated(this.routesData, 0);
    }

    return flightRoute;
  }

  // Draw routes on Leaflet map
  renderRoutesOnMap() {
    this.routesGroup.clearLayers();

    if (!this.routesData || this.routesData.length === 0) return;

    // Render alternative routes first (in muted gray/dashed)
    this.routesData.forEach((route, idx) => {
      if (idx === this.selectedRouteIndex) return;

      const geojsonLayer = L.geoJSON(route.geometry, {
        style: {
          color: '#94a3b8',
          weight: 4,
          opacity: 0.55,
          dashArray: '6, 6'
        }
      });

      geojsonLayer.on('click', () => {
        this.selectRoute(idx);
      });

      this.routesGroup.addLayer(geojsonLayer);
    });

    // Render selected active route on top with vibrant glowing color
    const activeRoute = this.routesData[this.selectedRouteIndex];
    if (activeRoute && activeRoute.geometry) {
      // Glow underlayer
      const glowLayer = L.geoJSON(activeRoute.geometry, {
        style: {
          color: '#818cf8',
          weight: 8,
          opacity: 0.4
        }
      });
      this.routesGroup.addLayer(glowLayer);

      // Main route line
      const mainLayer = L.geoJSON(activeRoute.geometry, {
        style: {
          color: '#4f46e5',
          weight: 5,
          opacity: 0.95
        }
      });
      this.routesGroup.addLayer(mainLayer);

      // Fit map viewport to active route bounds
      this.map.fitBounds(mainLayer.getBounds(), { padding: [45, 45] });
    }
  }

  // Select alternative route
  selectRoute(index) {
    if (index >= 0 && index < this.routesData.length) {
      this.selectedRouteIndex = index;
      this.renderRoutesOnMap();
      if (this.onRouteCalculated) {
        this.onRouteCalculated(this.routesData, this.selectedRouteIndex);
      }
    }
  }

  // Render static saved route (e.g. for Records detail view)
  renderStoredRoute(geometry, bounds = null) {
    if (!this.map) this.init();
    this.routesGroup.clearLayers();
    if (!geometry) return;

    const layer = L.geoJSON(geometry, {
      style: {
        color: '#6366f1',
        weight: 5,
        opacity: 0.9
      }
    }).addTo(this.routesGroup);

    if (bounds) {
      this.map.fitBounds(bounds, { padding: [30, 30] });
    } else {
      this.map.fitBounds(layer.getBounds(), { padding: [30, 30] });
    }
  }

  invalidateSize() {
    if (this.map) {
      setTimeout(() => this.map.invalidateSize(), 200);
    }
  }
}

window.SmartTripMap = SmartTripMap;
