// ============================================================
// Express.js Pathfinding Server (server.js)
// ============================================================

const express = require('express');
const cors = require('cors');
const fs = require('fs');
const path = require('path');
const csv = require('csv-parser');

const NavigationGrid = require('./navigation-grid.js');
const AStarPathfinder = require('./a-star-pathfinder.js');


const app = express();
const port = 3000;

app.use(cors());
app.use(express.static(path.join(__dirname, 'public')));
app.use(express.json({ limit: '50mb' }));

let landGrid = null;
let portData = [];

function initializeServer() {
    console.log('Server starting up...');
    const landCachePath = path.join(__dirname, './cache/grid-cache.json');
    const depthCachePath = path.join(__dirname, 'depth-cache.json');

    if (fs.existsSync(landCachePath)) {
        console.log('Loading land navigation grid from cache...');
        landGrid = new NavigationGrid(JSON.parse(fs.readFileSync(landCachePath)));
        console.log('Land grid loaded.');
    } else {
        console.error('CRITICAL: grid-cache.json not found. Please generate it.');
    }

    const portFilePath = path.join(__dirname, './cache/ports.csv');
    if (fs.existsSync(portFilePath)) {
        console.log('Loading port data from CSV...');
        fs.createReadStream(portFilePath)
            .pipe(csv())
            .on('data', (row) => {
                const lat = parseFloat(row['Latitude']);
                const lng = parseFloat(row['Longitude']);
                const portName = row['Main Port Name'];
                const country = row['Country Code'];

                if (portName && country && !isNaN(lat) && !isNaN(lng)) {
                    portData.push({ name: `${portName}, ${country}`, lat: lat, lng: lng });
                }
            })
            .on('end', () => {
                console.log(`Successfully loaded ${portData.length} ports.`);
                console.log('Server is ready.');
            });
    } else {
        console.error('CRITICAL: ports.csv not found.');
        console.log('Server is ready (but port search will not work).');
    }
}


app.get('/api/ports', (req, res) => {
    if (portData.length > 0) res.json(portData);
    else res.status(503).json({ error: 'Port data is not ready or failed to load.' });
});

app.get('/api/route', (req, res) => {
    if (!landGrid) {
        return res.status(503).json({ error: 'Pathfinder is not ready yet.' });
    }
    
    // UPDATED: Accept all new environmental parameters
    const { 
        start, end, speed, draft, hpReq, fuelRate, k, baseWeight, load, F, S,
        rainProbability, rainIntensity, seaDepth, windStrength, windDirection,
        currentStrength, currentDirection, waveHeight, waveDirection
    } = req.query;

    // UPDATED: Validation check for all parameters
    const requiredParams = { start, end, speed, draft, hpReq, fuelRate, k, baseWeight, load, F, S, rainProbability, rainIntensity, seaDepth, windStrength, windDirection, currentStrength, currentDirection, waveHeight, waveDirection };
    for (const param in requiredParams) {
        if (!requiredParams[param]) {
            return res.status(400).json({ error: `Missing required parameter: ${param}.` });
        }
    }

    try {
        const startCoords = start.split(',').map(Number);
        const endCoords = end.split(',').map(Number);
        
        const pathfinder = new AStarPathfinder();

        // UPDATED: Pass all parameters to the pathfinder
        const params = {
            speed: parseFloat(speed), draft: parseFloat(draft), hpReq: parseFloat(hpReq),
            fuelRate: parseFloat(fuelRate), k: parseFloat(k), baseWeight: parseFloat(baseWeight),
            load: parseFloat(load), F: parseFloat(F), S: parseFloat(S),
            rainProbability: parseFloat(rainProbability), rainIntensity: parseFloat(rainIntensity),
            seaDepth: parseFloat(seaDepth), windStrength: parseFloat(windStrength),
            windDirection: parseFloat(windDirection), currentStrength: parseFloat(currentStrength),
            currentDirection: parseFloat(currentDirection), waveHeight: parseFloat(waveHeight),
            waveDirection: parseFloat(waveDirection)
        };

        const path = pathfinder.findPath(
            landGrid,
            { lat: startCoords[0], lng: startCoords[1] },
            { lat: endCoords[0], lng: endCoords[1] },
            params
        );
        
        res.json(path || []);
    } catch (error) {
        console.error("Error during pathfinding:", error);
        res.status(500).json({ error: "An error occurred during pathfinding." });
    }
});

app.get('/api/grid', (req, res) => {
    // ... endpoint remains the same ...
    if (!landGrid) return res.status(503).json({ error: 'Grid data is not ready.' });
    res.json({ grid: landGrid.grid, bounds: landGrid.bounds, resolution: landGrid.resolution });
});

app.post('/api/grid/update', (req, res) => {
    const newGridData = req.body;
    if (!newGridData || !newGridData.grid) return res.status(400).json({ error: 'Invalid grid data.' });
    try {
        const timestamp = Date.now();
        const newCacheFilename = `grid-cache-${timestamp}.json`;
        const newCachePath = path.join(__dirname, newCacheFilename);
        fs.writeFileSync(newCachePath, JSON.stringify(newGridData, null, 2));
        console.log(`New grid cache saved to: ${newCacheFilename}`);
        res.status(200).json({ message: 'New grid copy saved!', filename: newCacheFilename });
    } catch (error) {
        console.error('Error saving new grid cache:', error);
        res.status(500).json({ error: 'Failed to save grid updates.' });
    }
});

app.get("/api/depth", async (req, res) => {
    const startLatLng = { lat: parseFloat(req.query.startLat), lng: parseFloat(req.query.startLon) };
    const endLatLng = { lat: parseFloat(req.query.endLat), lng: parseFloat(req.query.endLon) };

    const params = {}; // add your params if needed

    try {
        const result = await pathfinder.findPath({}, startLatLng, endLatLng, params);
        res.json({ path: result });
    } catch (err) {
        res.status(500).json({ error: err.toString() });
    }
});



app.listen(port, () => {
    initializeServer();
    console.log(`Pathfinding server listening at http://localhost:${port}`);
});