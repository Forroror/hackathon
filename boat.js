// ============================================================
// BOAT ANIMATION MODULE (boat.js)
// ============================================================

class BoatAnimator {
    constructor(map) {
        this.map = map;
        this.boatMarker = null;
        this.trailLine = null;
        this.animationFrameId = null;
        this.isAnimating = false;
        this.environmentalParams = {};
        this.envDataCache = null;
    }

    _createBoatIcon() {
        const boatSVG = `<svg class="boat-icon" width="24" height="24" viewBox="0 0 24 24" fill="#3b82f6" stroke="white" stroke-width="1.5"><path d="M12 2L2 19h20L12 2z"/></svg>`;
        return L.divIcon({
            html: boatSVG,
            className: 'boat-icon-wrapper',
            iconSize: [24, 24],
            iconAnchor: [12, 12]
        });
    }

    startAnimation(path, params, animationDurationSeconds = 30) {
        if (!path || path.length < 2) {
            showMessage('No route available to animate.', 'red');
            return;
        }
        this.stopAnimation();
        this.environmentalParams = params;
        this.envDataCache = envDataCache;

        const lineCoords = path.map(p => [p.lng, p.lat]);
        const turfLine = turf.lineString(lineCoords);
        const totalDistance = turf.length(turfLine, { units: 'kilometers' });
        
        // FIX: Ensure the marker is always created and added correctly
        if (!this.boatMarker) {
            const startLatLng = [path[0].lat, path[0].lng];
            this.boatMarker = L.marker(startLatLng, {
                icon: this._createBoatIcon(),
                zIndexOffset: 1000
            });
        }
        this.boatMarker.addTo(this.map);

        this.trailLine = L.polyline([], { color: '#1d4ed8', weight: 5 }).addTo(this.map);

        document.getElementById('hud-animation-progress').classList.remove('hidden');
        document.getElementById('turn-by-turn-panel').classList.remove('hidden');
        this.isAnimating = true;
        const startTime = performance.now();
        const durationMs = animationDurationSeconds * 1000;

        const animate = (timestamp) => {
            if (!this.isAnimating) return;

            const elapsed = timestamp - startTime;
            let progress = elapsed / durationMs;
            if (progress > 1) progress = 1;

            const distanceAlong = totalDistance * progress;
            //(gm)
            const currentPoint = turf.along(turfLine, distanceAlong, { units: 'kilometers' });
            const currentLatLng = [currentPoint.geometry.coordinates[1], currentPoint.geometry.coordinates[0]]; 
            this.boatMarker.setLatLng(currentLatLng); 
            const boatBearing = this.updateBearingAndRotation(currentPoint, distanceAlong, turfLine, totalDistance);
            this.updateTrail(currentPoint, turfLine);
            const currentSpeed = this.calculateCurrentSpeed(boatBearing, currentLatLng[0], currentLatLng[1]);

            this.updateAnimationProgress(totalDistance - distanceAlong, currentSpeed);
            this.updateTurnInstruction(path, distanceAlong, boatBearing);

            if (progress < 1) {
                this.animationFrameId = requestAnimationFrame(animate);
            } else {
                this.isAnimating = false;
                document.getElementById('turn-instruction').textContent = "Arrived at Destination";
                document.getElementById('turn-distance').textContent = "";
                showMessage('Animation finished.', 'green');
            }
        };

        this.animationFrameId = requestAnimationFrame(animate);
    }

    stopAnimation() {
        if (this.animationFrameId) cancelAnimationFrame(this.animationFrameId);
        this.isAnimating = false;
        this.animationFrameId = null;

        if (this.boatMarker) this.map.removeLayer(this.boatMarker);
        if (this.trailLine) this.map.removeLayer(this.trailLine);
        
        this.boatMarker = null;
        this.trailLine = null;
        
        document.getElementById('hud-animation-progress').classList.add('hidden');
        document.getElementById('turn-by-turn-panel').classList.add('hidden');
    }

    updateBearingAndRotation(currentPoint, distanceAlong, turfLine, totalDistance) {
        let bearing = 0;
        if (distanceAlong < totalDistance) {
            const nextPoint = turf.along(turfLine, distanceAlong + 0.1, { units: 'kilometers' });
            bearing = turf.bearing(currentPoint, nextPoint);
        } else {
            const prevPoint = turf.along(turfLine, totalDistance - 0.1, { units: 'kilometers' });
            bearing = turf.bearing(prevPoint, currentPoint);
        }
        
        const iconElement = this.boatMarker.getElement();
        if (iconElement) {
            iconElement.style.transformOrigin = 'center center';
            iconElement.style.transform = `rotate(${bearing}deg)`;
        }
        return bearing;
    }

    updateTrail(currentPoint, turfLine) {
        const startOfLine = turf.point(turfLine.geometry.coordinates[0]);
        const trailGeoJSON = turf.lineSlice(startOfLine, currentPoint, turfLine);
        const trailLatLngs = trailGeoJSON.geometry.coordinates.map(coords => [coords[1], coords[0]]);
        this.trailLine.setLatLngs(trailLatLngs);
    }

    // boat.js

    calculateCurrentSpeed(boatBearing, currentLat, currentLng) { // <<< ADD currentLat, currentLng
        const baseSpeed = parseFloat(this.environmentalParams.speed) || 15;
        let speedModifier = 0;

        // Get live data from the cache for the boat's current position
        const liveEnvData = this.getEnvDataAtPoint(currentLat, currentLng);

        if (liveEnvData) {
            // Wind Effect
            const windAngleDiff = Math.abs(boatBearing - liveEnvData.wind_direction_deg);
            speedModifier += liveEnvData.wind_speed_mps * 0.5 * Math.cos(windAngleDiff * Math.PI / 180);

            // Current Effect
            const currentAngleDiff = Math.abs(boatBearing - liveEnvData.current_direction_deg);
            speedModifier += liveEnvData.current_speed_mps * 1.5 * Math.cos(currentAngleDiff * Math.PI / 180);
        }

        return Math.max(0.1, baseSpeed + speedModifier);
    }

    updateAnimationProgress(distanceLeftKm, currentSpeedKnots) {
        const timeHoursLeft = currentSpeedKnots > 0 ? distanceLeftKm / (currentSpeedKnots * 1.852) : Infinity;
        const days = Math.floor(timeHoursLeft / 24);
        const remainingHours = Math.round(timeHoursLeft % 24);
    
        document.getElementById('hud-current-speed').textContent = `${currentSpeedKnots.toFixed(1)} kts`;
        document.getElementById('hud-distance-left').textContent = `${distanceLeftKm.toFixed(0)} km`;
        document.getElementById('hud-time-left').textContent = `${days}d ${remainingHours}h`;
    }

    updateTurnInstruction(path, distanceAlong, currentBearing) {
        let nextTurnPointIndex = -1;
        let cumulativeDistance = 0;

        // Find the next significant turn
        for (let i = 1; i < path.length - 1; i++) {
            const p1 = turf.point([path[i-1].lng, path[i-1].lat]);
            const p2 = turf.point([path[i].lng, path[i].lat]);
            const p3 = turf.point([path[i+1].lng, path[i+1].lat]);
            
            cumulativeDistance += turf.distance(p1, p2);

            if (cumulativeDistance > distanceAlong) {
                const bearing1 = turf.bearing(p1, p2);
                const bearing2 = turf.bearing(p2, p3);
                let turnAngle = bearing2 - bearing1;
                if (turnAngle > 180) turnAngle -= 360;
                if (turnAngle < -180) turnAngle += 360;

                if (Math.abs(turnAngle) > 15) { // Only show turns greater than 15 degrees
                    nextTurnPointIndex = i;
                    break;
                }
            }
        }

        if (nextTurnPointIndex !== -1) {
            const distanceToTurn = cumulativeDistance - distanceAlong;
            const turnNode = path[nextTurnPointIndex];
            const nextSegmentNode = path[nextTurnPointIndex + 1];
            
            const nextBearing = turf.bearing(
                turf.point([turnNode.lng, turnNode.lat]),
                turf.point([nextSegmentNode.lng, nextSegmentNode.lat])
            );

            let turnAngle = nextBearing - currentBearing;
            if (turnAngle > 180) turnAngle -= 360;
            if (turnAngle < -180) turnAngle += 360;

            const direction = turnAngle > 0 ? "Starboard" : "Port";
            
            document.getElementById('turn-instruction').textContent = `Turn ${Math.abs(turnAngle).toFixed(0)}° ${direction}`;
            document.getElementById('turn-distance').textContent = `In ${distanceToTurn.toFixed(1)} km`;
        } else {
            document.getElementById('turn-instruction').textContent = "Maintain Course";
            const distanceToDestination = turf.length(turf.lineString(path.map(p => [p.lng, p.lat]))) - distanceAlong;
            document.getElementById('turn-distance').textContent = `Destination in ${distanceToDestination.toFixed(1)} km`;
        }
    }

        //helper to get the current live data for boat
        getEnvDataAtPoint(lat, lon) {
        if (!this.envDataCache) return null;

        // Helper to find the closest index
        const findClosestIndex = (arr, target) => {
            let low = 0, high = arr.length - 1;
            while (low <= high) {
                const mid = Math.floor((low + high) / 2);
                if (arr[mid] === target) return mid;
                if (arr[mid] < target) low = mid + 1;
                else high = mid - 1;
            }
            return (low > 0 && (low === arr.length || Math.abs(arr[low] - target) > Math.abs(arr[low - 1] - target))) ? low - 1 : low;
        };

        const lat_idx = findClosestIndex(this.envDataCache.lats, lat);
        const lon_idx = findClosestIndex(this.envDataCache.lons, lon);

        const getValue = (gridName) => this.envDataCache[gridName]?.[lat_idx]?.[lon_idx];

        //value need to show
        return {
            wind_direction_deg: getValue('wind_direction_deg'),
            wind_speed_mps: getValue('wind_speed_mps'),
            current_direction_deg: getValue('current_direction_deg'),
            current_speed_mps: getValue('current_speed_mps'),
        
        };
    }
}