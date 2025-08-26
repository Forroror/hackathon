// ============================================================
// MAIN APPLICATION SCRIPT (main.js) - SERVER VERSION
// ============================================================

// --- INITIALIZATION ---
const messageBox = document.getElementById('messageBox');
let currentPath = [];

// --- STATE MANAGEMENT ---
let navigationState = 'SET_START';
let startPoint = null;
let endPoint = null;
let startMarker = null;
let endMarker = null;
let boatAnimation = null;
let boatAnimator = null;
let isAnimationEnabled = false;
let gridLayer = L.layerGroup();
let isGridVisible = false;
let gridDataCache = null;
let editMode = false;
let isDrawing = false;
let drawMode = 'draw';
let routeLayer = L.layerGroup();
let heatLayer = null;
let isHeatmapVisible = false;
let depthDataCache = null;
let portData = [];

// --- Ship Type Presets ---

// ev new 
// adding defaults value for shipLength,beam,hullType
const shipTypeDefaults = {
    fishing_trawler: { shipLength:35 ,beam:8 , hullType: "displacement",baseWeight: 1500, load: 500, speed: 10, draft: 5, hpReq: 2000, fuelRate: 0.22 },
    handysize_bulk: { shipLength:130 ,beam:20 , hullType: "displacement",baseWeight: 20000, load: 35000, speed: 14, draft: 10, hpReq: 8000, fuelRate: 0.20 },
    panamax_container: { shipLength:280 ,beam:30 , hullType: "displacement",baseWeight: 40000, load: 50000, speed: 20, draft: 12, hpReq: 40000, fuelRate: 0.19 },
    aframax_tanker: { shipLength:200 ,beam:30 , hullType: "displacement",baseWeight: 55000, load: 100000, speed: 15, draft: 14, hpReq: 18000, fuelRate: 0.18 },
    vlcc_tanker: { shipLength:300 ,beam:58 , hullType: "displacement",baseWeight: 120000, load: 300000, speed: 16, draft: 20, hpReq: 30000, fuelRate: 0.18 },
    cruise_ship: { shipLength:365 ,beam:65 , hullType: "displacement",baseWeight: 100000, load: 20000, speed: 22, draft: 8, hpReq: 90000, fuelRate: 0.21 }
};

// --- MAP SETUP ---
const map = L.map('map', { center: [1.3521, 103.8198], zoom: 7, zoomControl: false, doubleClickZoom: false });
L.tileLayer('https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png', {
    attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors &copy; <a href="https://carto.com/attributions">CARTO</a>',
    subdomains: 'abcd', maxZoom: 20
}).addTo(map);
L.control.zoom({ position: 'bottomright' }).addTo(map);

// --- APPLICATION INITIALIZATION ---
function initializeApp() {
    showMessage('Map ready. Use the search or double-click to set a route.', 'green');
    routeLayer.addTo(map);
    boatAnimator = new BoatAnimator(map);
    map.on('moveend zoomend', () => { if (isGridVisible) drawGrid(); });
    map.on('mousedown', (e) => { if (editMode) { isDrawing = true; drawMode = (e.originalEvent.button === 0) ? 'draw' : 'erase'; editGridCell(e); } });
    map.on('mousemove', (e) => { if (editMode && isDrawing) editGridCell(e); });
    window.addEventListener('mouseup', () => { isDrawing = false; });
    map.on('contextmenu', (e) => { if (editMode) L.DomEvent.preventDefault(e); });
    document.addEventListener('keydown', (e) => { if (e.code === 'Space' && editMode) { map.dragging.enable(); L.DomUtil.addClass(map._container, 'pan-cursor'); } });
    document.addEventListener('keyup', (e) => { if (e.code === 'Space' && editMode) { map.dragging.disable(); L.DomUtil.removeClass(map._container, 'pan-cursor'); } });
    document.getElementById('shipType').addEventListener('change', updateShipParameters);
    updateShipParameters();
    initializeTooltips();
    loadPortData();
    setupSearchListeners();
}

// --- Port Search, Ship Presets, and Tooltips ---
function loadPortData(){fetch('/api/ports').then(response=>{if(!response.ok)throw new Error('Failed to load port data');return response.json()}).then(data=>{portData=data;const portsList=document.getElementById('ports-list');if(portsList){portsList.innerHTML=portData.map(port=>`<option value="${port.name}"></option>`).join('')}showMessage('Port data loaded.','green')}).catch(error=>{console.error('Error fetching port data:',error);showMessage('Could not load port data from server.','red')})}
function setupSearchListeners(){const startInput=document.getElementById('startPort');const endInput=document.getElementById('endPort');const handleSelection=()=>{resetNavigation(false);const startValue=startInput.value;const endValue=endInput.value;const startPort=portData.find(p=>p.name===startValue);const endPort=portData.find(p=>p.name===endValue);if(startMarker)map.removeLayer(startMarker);if(endMarker)map.removeLayer(endMarker);if(startPort){startPoint=L.latLng(startPort.lat,startPort.lng);startMarker=L.circleMarker(startPoint,{color:'#10b981',radius:8,fillOpacity:0.8}).addTo(map)}if(endPort){endPoint=L.latLng(endPort.lat,endPort.lng);endMarker=L.circleMarker(endPoint,{color:'#ef4444',radius:8,fillOpacity:0.8}).addTo(map)}if(startPort&&endPort){const bounds=L.latLngBounds([startPoint,endPoint]);map.fitBounds(bounds.pad(0.2));calculateAndFetchRoute(startPoint,endPoint)}};startInput.addEventListener('change',handleSelection);endInput.addEventListener('change',handleSelection)}
// ev new 
// adding shipLength,beam,hullType to updateShipParameters function
function updateShipParameters(){const selectedType=document.getElementById('shipType').value;const defaults=shipTypeDefaults[selectedType];if(defaults){document.getElementById('shipLength').value=defaults.shipLength; document.getElementById('beam').value=defaults.beam;document.getElementById('hullType').value=defaults.hullType;document.getElementById('baseWeight').value=defaults.baseWeight;document.getElementById('load').value=defaults.load;document.getElementById('shipSpeed').value=defaults.speed;document.getElementById('shipDraft').value=defaults.draft;document.getElementById('hpReq').value=defaults.hpReq;document.getElementById('fuelRate').value=defaults.fuelRate}}
function initializeTooltips(){const labels=document.querySelectorAll('.info-label');const tooltip=document.getElementById('tooltip');labels.forEach(label=>{label.addEventListener('mouseenter',e=>{tooltip.textContent=e.target.dataset.tooltip;tooltip.style.opacity='1';tooltip.style.display='block'});label.addEventListener('mousemove',e=>{tooltip.style.left=`${e.clientX+15}px`;tooltip.style.top=`${e.clientY+15}px`});label.addEventListener('mouseleave',()=>{tooltip.style.opacity='0';setTimeout(()=>{if(tooltip.style.opacity==='0')tooltip.style.display='none'},200)})})}

// --- NAVIGATION & ROUTING LOGIC ---
function calculateAndFetchRoute(start, end) {
    if (boatAnimation) {
        boatAnimation.stopAnimation();
    }    
    showMessage('Calculating route...', 'blue');
    navigationState = 'CALCULATING';
    
    
    const params = {
        //ev new
        //adding shipLength,beam,hullType to params
        shipLength: document.getElementById('shipLength').value, beam: document.getElementById('beam').value, hullType: document.getElementById('hullType').value,
        speed: document.getElementById('shipSpeed').value, draft: document.getElementById('shipDraft').value,
        hpReq: document.getElementById('hpReq').value, fuelRate: document.getElementById('fuelRate').value,
        k: document.getElementById('hullFactor').value, baseWeight: document.getElementById('baseWeight').value,
        load: document.getElementById('load').value, F: document.getElementById('foulingFactor').value,
        S: document.getElementById('seaStateFactor').value, 
        
        // setting all environmental parameters to default 1 for now
        rainProbability: 1, rainIntensity: 1,
        seaDepth: 100, windStrength: 1, windDirection: 1, currentStrength: 1,
        currentDirection: 1, waveHeight: 1, waveDirection: 1
    };

    for (const key in params) {
        if (!params[key] && params[key] !== 0) {
            showMessage(`Error: Parameter '${key}' is missing. Please check vessel inputs.`, 'red');
            navigationState = 'SET_END';
            return;
        }
    }

    const startCoords = `${start.lat},${start.lng}`;
    const endCoords = `${end.lat},${end.lng}`;
    const queryString = `start=${startCoords}&end=${endCoords}&` + 
                        Object.entries(params).map(([key, value]) => `${key}=${value}`).join('&');

    fetch(`/api/route?${queryString}`)
        .then(response => {
            if (!response.ok) throw new Error(`Server error: ${response.statusText}`);
            return response.json();
        })
        .then(path => {
            currentPath = path;
            if (path && path.length > 0) {
                drawMultiColorPath(path);
                // FIX: Calculate total distance ONCE and pass it to both functions
                const totalDistanceKm = calculateTotalDistance(path);
                calculateAndDisplayMetrics(path, params.speed, totalDistanceKm);
                updateHud(params, totalDistanceKm); // Pass distance to HUD
                
                navigationState = 'ROUTE_DISPLAYED';
                showMessage('Route found.', 'green');

                if (isAnimationEnabled) {
                    boatAnimator.startAnimation(path, params, totalDistanceKm);
                }
            } else {
                currentPath = [];
                showMessage('No valid route found.', 'red');
                navigationState = 'SET_START';
            }
        }).catch(error => {
            currentPath = [];
            console.error('Error fetching route:', error);
            showMessage('Could not connect to the routing server.', 'red');
            navigationState = 'SET_START';
        });
}

// --- UI UPDATE FUNCTIONS ---
function onMapClick(e){if(editMode||navigationState==='CALCULATING')return;if(navigationState==='ROUTE_DISPLAYED'){resetNavigation(true);document.getElementById('startPort').value='';document.getElementById('endPort').value=''}if(navigationState==='SET_START'){startPoint=e.latlng;if(startMarker)map.removeLayer(startMarker);startMarker=L.circleMarker(startPoint,{color:'#10b981',radius:8,fillOpacity:0.8}).addTo(map);navigationState='SET_END';showMessage('Start point set. Double-click to set destination.','blue')}else if(navigationState==='SET_END'){endPoint=e.latlng;if(endMarker)map.removeLayer(endMarker);endMarker=L.circleMarker(endPoint,{color:'#ef4444',radius:8,fillOpacity:0.8}).addTo(map);calculateAndFetchRoute(startPoint,endPoint)}}
map.on('dblclick',onMapClick);

function drawMultiColorPath(path){routeLayer.clearLayers();if(!path||path.length<2)return;let currentSegment=[];let currentTerrain=path[0].onLand;const waterStyle={color:'#3b82f6',weight:3};const landStyle={color:'#10b981',weight:4,dashArray:'5, 5'};for(let i=0;i<path.length;i++){const point=path[i];const latLng=L.latLng(point.lat,point.lng);const terrainChanged=point.onLand!==currentTerrain;const worldWrapped=i>0&&Math.abs(point.lng-path[i-1].lng)>180;if(terrainChanged||worldWrapped){if(currentSegment.length>0){if(terrainChanged&&!worldWrapped)currentSegment.push(latLng);if(currentSegment.length>1)L.polyline(currentSegment,currentTerrain?landStyle:waterStyle).addTo(routeLayer)}currentSegment=[latLng];currentTerrain=point.onLand}else{currentSegment.push(latLng)}}if(currentSegment.length>1)L.polyline(currentSegment,currentTerrain?landStyle:waterStyle).addTo(routeLayer)}

// NEW: Centralized distance calculation
function calculateTotalDistance(path) {
    let totalDistance = 0;
    for (let i = 1; i < path.length; i++) {
        const from = turf.point([path[i-1].lng, path[i-1].lat]);
        const to = turf.point([path[i].lng, path[i].lat]);
        totalDistance += turf.distance(from, to, { units: 'kilometers' });
    }
    return totalDistance;
}

function calculateAndDisplayMetrics(path, speed, totalDistanceKm){
    const totalFuelLiters=path[path.length-1].totalFuel;
    if(totalFuelLiters===undefined){console.error("Path data does not include totalFuel.");return}

    const speedKmh=speed*1.852;
    const totalHours=speedKmh>0?totalDistanceKm/speedKmh:0;
    const days=Math.floor(totalHours/24);
    const remainingHours=Math.round(totalHours%24);
    // ev note check this 0.0023
    const carbonTons=totalFuelLiters*0.0023;

    const metricsDisplay=document.getElementById('metrics-display');
    metricsDisplay.innerHTML=`
        <div class="flex justify-between items-center mb-2"><span class="text-gray-400">Travel Time:</span><span class="font-bold text-blue-400">${days}d ${remainingHours}h</span></div>
        <div class="flex justify-between items-center mb-2"><span class="text-gray-400">Total Distance:</span><span class="font-bold text-blue-400">${totalDistanceKm.toFixed(0)} km</span></div>
        <div class="flex justify-between items-center mb-2"><span class="text-gray-400">Fuel Consumed:</span><span class="font-bold text-blue-400">${totalFuelLiters.toFixed(0)} L</span></div>
        <div class="flex justify-between items-center"><span class="text-gray-400">CO₂ Emissions:</span><span class="font-bold text-blue-400">${carbonTons.toFixed(2)} tons</span></div>`;
    metricsDisplay.classList.remove('hidden');
}

function resetNavigation(showMsg=true){boatAnimator.stopAnimation();currentPath=[];navigationState='SET_START';startPoint=null;endPoint=null;routeLayer.clearLayers();if(startMarker)map.removeLayer(startMarker);if(endMarker)map.removeLayer(endMarker);startMarker=null;endMarker=null;document.getElementById('metrics-display').classList.add('hidden');hideHud();if(showMsg){showMessage('Route cleared. Ready for new route.','blue')}}


// what is this ?
function updateHud(params, totalDistanceKm) {
    document.getElementById('hud-wind').textContent = `${params.windStrength} kts @ ${params.windDirection}°`;
    document.getElementById('hud-current').textContent = `${params.currentStrength} kts @ ${params.currentDirection}°`;
    document.getElementById('hud-waves').textContent = `${params.waveHeight} m @ ${params.waveDirection}°`;
    document.getElementById('hud-rain').textContent = `${params.rainIntensity} mm/h (${params.rainProbability}%)`;
    document.getElementById('hud-sea-depth').textContent = `${params.seaDepth} m`;
    // FIX: Set the initial distance left value correctly
    document.getElementById('hud-distance-left').textContent = `${totalDistanceKm.toFixed(0)} km`;
    document.getElementById('navigation-hud').style.display = 'block';

}

function hideHud() {
    document.getElementById('navigation-hud').style.display = 'none';
}

// --- Grid, Heatmap, and Other Functions ---
function toggleGrid(){if(isGridVisible){map.removeLayer(gridLayer);isGridVisible=false;showMessage("Grid hidden.","blue")}else{if(gridDataCache){drawGrid();map.addLayer(gridLayer);isGridVisible=true}else{showMessage("Fetching grid data...","yellow");fetch("/api/grid").then(response=>response.json()).then(data=>{gridDataCache=data;drawGrid();map.addLayer(gridLayer);isGridVisible=true;showMessage("Grid displayed.","green")}).catch(error=>{console.error("Error fetching grid:",error);showMessage("Failed to load grid data.","red")})}}}
function drawGrid(){if(!gridDataCache)return;gridLayer.clearLayers();const{grid,bounds,resolution}=gridDataCache;const mapBounds=map.getBounds();const iMin=Math.max(0,Math.floor((mapBounds.getWest()-bounds.west)/resolution));const iMax=Math.min(grid.length-1,Math.ceil((mapBounds.getEast()-bounds.west)/resolution));const jMin=Math.max(0,Math.floor((mapBounds.getSouth()-bounds.south)/resolution));const jMax=Math.min(grid[0].length-1,Math.ceil((mapBounds.getNorth()-bounds.south)/resolution));const landStyle={color:"rgba(239, 68, 68, 0.5)",weight:1,fillOpacity:0.2};for(let i=iMin;i<=iMax;i++){for(let j=jMin;j<=jMax;j++){if(grid[i]&&grid[i][j]===1){const west=bounds.west+i*resolution;const south=bounds.south+j*resolution;const east=west+resolution;const north=south+resolution;L.rectangle([[south,west],[north,east]],landStyle).addTo(gridLayer)}}}}
function drawHeatmap(data){if(heatLayer)map.removeLayer(heatLayer);const{grid,bounds,resolution}=data;const heatPoints=[];let minDepth=0;for(const col of grid){if(col){for(const depth of col){if(depth<minDepth){minDepth=depth}}}}if(minDepth===0){showMessage("No depth data found in the current file to display.","yellow");return}for(let i=0;i<grid.length;i++){if(grid[i]){for(let j=0;j<grid[i].length;j++){const depth=grid[i][j];if(depth<0){const lat=bounds.south+j*resolution;const lng=bounds.west+i*resolution;const intensity=1-(depth/minDepth);heatPoints.push([lat,lng,intensity])}}}}heatLayer=L.heatLayer(heatPoints,{radius:15,blur:20,maxZoom:10,gradient:{0.4:"blue",0.65:"lime",0.8:"yellow",1.0:"red"}}).addTo(map)}
function toggleEditMode(){editMode=!editMode;const editButton=document.getElementById("edit-grid-button");const saveButton=document.getElementById("save-grid-button");if(editMode){if(!isGridVisible)toggleGrid();showMessage("Edit Mode ON. Left-drag to draw, Right-drag to erase.","purple");L.DomUtil.addClass(map._container,"edit-cursor");editButton.classList.add("bg-blue-500");saveButton.classList.remove("hidden");map.dragging.disable()}else{showMessage("Grid Edit Mode OFF.","blue");L.DomUtil.removeClass(map._container,"edit-cursor");editButton.classList.remove("bg-blue-500");saveButton.classList.add("hidden");map.dragging.enable()}}
function editGridCell(e){if(!gridDataCache)return;const{grid,bounds,resolution}=gridDataCache;const i=Math.floor((e.latlng.lng-bounds.west)/resolution);const j=Math.floor((e.latlng.lat-bounds.south)/resolution);if(grid[i]&&grid[i][j]!==undefined){const targetValue=drawMode==="draw"?1:0;if(grid[i][j]!==targetValue){grid[i][j]=targetValue;drawGrid()}}}
function saveGrid(){if(!gridDataCache){showMessage("No grid data to save.","red");return}showMessage("Saving a new copy of the grid to the server...","yellow");fetch("/api/grid/update",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify(gridDataCache)}).then(response=>response.json()).then(data=>{showMessage(`${data.message} Filename: ${data.filename}`,"green")}).catch(error=>{console.error("Error saving grid:",error);showMessage("Failed to save grid.","red")})}
function downloadGrid(){if(!gridDataCache){showMessage("No grid data to download.","red");return}showMessage("Preparing download...","blue");const dataStr="data:text/json;charset=utf-8,"+encodeURIComponent(JSON.stringify(gridDataCache));const downloadAnchorNode=document.createElement("a");downloadAnchorNode.setAttribute("href",dataStr);downloadAnchorNode.setAttribute("download",`edited-grid-cache-${Date.now()}.json`);document.body.appendChild(downloadAnchorNode);downloadAnchorNode.click();downloadAnchorNode.remove();showMessage("Download started.","green")}
function uploadGrid(){const fileInput=document.createElement("input");fileInput.type="file";fileInput.accept=".json";fileInput.onchange=e=>{const file=e.target.files[0];if(!file)return;showMessage(`Reading ${file.name}...`,"blue");const reader=new FileReader;reader.onload=event=>{try{const uploadedData=JSON.parse(event.target.result);if(uploadedData.grid&&uploadedData.bounds&&uploadedData.hasOwnProperty("resolution")){gridDataCache=uploadedData;showMessage("Custom grid loaded successfully!","green");if(isGridVisible){drawGrid()}}else{showMessage("Invalid grid file format.","red")}}catch(error){console.error("Error parsing JSON file:",error);showMessage("Could not read the uploaded file.","red")}};reader.readAsText(file)};fileInput.click()}

function toggleBoatAnimation() {
    isAnimationEnabled = !isAnimationEnabled;
    const animButton = document.getElementById('toggle-animation-button').parentElement;
    if (isAnimationEnabled) {
        showMessage('Boat animation ON.', 'green');
        animButton.classList.add('toggled-on');
        if (navigationState === 'ROUTE_DISPLAYED' && currentPath && currentPath.length > 0) {
            const params = { 
                speed: document.getElementById('shipSpeed').value,

                // set temporary value for windStrength etc
                windStrength: 1, windDirection: 1,
                currentStrength: 1, currentDirection: 1
            };
            // FIX: Pass the pre-calculated total distance to the animator
            const totalDistanceKm = calculateTotalDistance(currentPath);
            boatAnimator.startAnimation(currentPath, params, totalDistanceKm);
            document.getElementById('hud-environmental-conditions').style.display = 'block';
            document.getElementById('navigation-hud').style.display = 'block';
        }
    } else {
        showMessage('Boat animation OFF.', 'blue');
        animButton.classList.remove('toggled-on');
        boatAnimator.stopAnimation();
        document.getElementById('hud-environmental-conditions').style.display = 'none';
        hideHud()
    }
}

function showMessage(text,color='blue'){messageBox.textContent=text;messageBox.className=`fixed top-5 left-1/2 -translate-x-1/2 bg-${color}-600 text-white py-3 px-6 rounded-lg shadow-lg z-[1000] text-center transition-opacity duration-300`;messageBox.style.opacity=1;setTimeout(()=>{messageBox.style.opacity=0},5000)}
const CustomControl=L.Control.extend({options:{position:'bottomright',icon:'',title:'',action:()=>{},id:''},onAdd:function(){const container=L.DomUtil.create('div','leaflet-bar leaflet-control');container.innerHTML=`<a href="#" id="${this.options.id}" title="${this.options.title}" role="button" class="custom-control bg-gray-700 hover:bg-gray-600 flex items-center justify-center w-9 h-9 rounded-md shadow-md">${this.options.icon}</a>`;L.DomEvent.on(container,'click',e=>{L.DomEvent.stopPropagation(e);L.DomEvent.preventDefault(e);this.options.action()});return container}});
const resetIcon=`<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="feather feather-refresh-cw"><polyline points="23 4 23 10 17 10"></polyline><polyline points="1 20 1 14 7 14"></polyline><path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15"></path></svg>`;
const gridIcon=`<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="feather feather-grid"><rect x="3" y="3" width="7" height="7"></rect><rect x="14" y="3" width="7" height="7"></rect><rect x="14" y="14" width="7" height="7"></rect><rect x="3" y="14" width="7" height="7"></rect></svg>`;
const editIcon=`<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="feather feather-edit"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"></path><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"></path></svg>`;
const saveIcon=`<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="feather feather-save"><path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z"></path><polyline points="17 21 17 13 7 13 7 21"></polyline><polyline points="7 3 7 8 15 8"></polyline></svg>`;
const downloadIcon=`<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="feather feather-download"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path><polyline points="7 10 12 15 17 10"></polyline><line x1="12" y1="15" x2="12" y2="3"></line></svg>`;
const uploadIcon=`<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="feather feather-upload"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path><polyline points="17 8 12 3 7 8"></polyline><line x1="12" y1="3" x2="12" y2="15"></line></svg>`;
const heatIcon=`<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="feather feather-thermometer"><path d="M14 14.76V3.5a2.5 2.5 0 0 0-5 0v11.26a4.5 4.5 0 1 0 5 0z"></path></svg>`;
const boatIcon=`<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="feather feather-send"><line x1="22" y1="2" x2="11" y2="13"></line><polygon points="22 2 15 22 11 13 2 9 22 2"></polygon></svg>`;
new CustomControl({icon:resetIcon,title:'Reset Route',action:resetNavigation}).addTo(map);
new CustomControl({icon:gridIcon,title:'Toggle Grid',action:toggleGrid}).addTo(map);
new CustomControl({id:'edit-grid-button',icon:editIcon,title:'Toggle Edit Mode',action:toggleEditMode}).addTo(map);
const saveButtonControl=new CustomControl({id:'save-grid-button',icon:saveIcon,title:'Save Grid Changes',action:saveGrid});
saveButtonControl.addTo(map);
document.getElementById('save-grid-button').parentElement.classList.add('hidden');
new CustomControl({icon:downloadIcon,title:'Download Grid',action:downloadGrid}).addTo(map);
new CustomControl({icon:uploadIcon,title:'Upload Grid',action:uploadGrid}).addTo(map);
new CustomControl({id:'toggle-animation-button',icon:boatIcon,title:'Toggle Boat Animation',action:toggleBoatAnimation}).addTo(map);
const style=document.createElement('style');
style.innerHTML=`
    .edit-cursor { cursor: cell !important; }
    .pan-cursor { cursor: grab !important; }
    .pan-cursor:active { cursor: grabbing !important; }
    .leaflet-control.toggled-on a { background-color: #3b82f6 !important; } /* Toggled style */
    .boat-icon-wrapper { transition: transform 0.1s linear; } /* Smooth rotation for the boat */
`;
document.head.appendChild(style);

initializeApp();
