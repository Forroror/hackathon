class MinHeap {
    // MinHeap implementation remains the same...
    constructor() { this.heap = []; }
    push(node) { this.heap.push(node); this.bubbleUp(); }
    pop() {
        const min = this.heap[0];
        const end = this.heap.pop();
        if (this.heap.length > 0) { this.heap[0] = end; this.sinkDown(0); }
        return min;
    }
    size() { return this.heap.length; }
    bubbleUp() {
        let index = this.heap.length - 1;
        const node = this.heap[index];
        while (index > 0) {
            let parentIndex = Math.floor((index - 1) / 2);
            let parent = this.heap[parentIndex];
            if (node.f >= parent.f) break;
            this.heap[parentIndex] = node;
            this.heap[index] = parent;
            index = parentIndex;
        }
    }
    sinkDown(index) {
        const length = this.heap.length;
        const node = this.heap[index];
        while (true) {
            let leftChildIdx = 2 * index + 1, rightChildIdx = 2 * index + 2, swap = null;
            if (leftChildIdx < length) {
                let leftChild = this.heap[leftChildIdx];
                if (leftChild.f < node.f) swap = leftChildIdx;
            }
            if (rightChildIdx < length) {
                let rightChild = this.heap[rightChildIdx];
                if ((swap === null && rightChild.f < node.f) || (swap !== null && rightChild.f < this.heap[swap].f)) {
                    swap = rightChildIdx;
                }
            }
            if (swap === null) break;
            this.heap[index] = this.heap[swap];
            this.heap[swap] = node;
            index = swap;
        }
    }
}



class AStarPathfinder {
    /**
     * Finds the most fuel-efficient path, handling land-to-water transitions.
     * @param {NavigationGrid} landGrid - The grid defining land (1) and water (0).
     * @param {object} startLatLng - The starting coordinates { lat, lng }.
     * @param {object} endLatLng - The ending coordinates { lat, lng }.
     * @param {object} params - All vessel and environmental parameters.
     * @returns {Array<object>|null} The path with fuel info, or null.
     */
    findPath(landGrid, startLatLng, endLatLng, params) {
        const originalStartNode = landGrid.latLngToGrid(startLatLng);
        const originalEndNode = landGrid.latLngToGrid(endLatLng);

        if (originalStartNode.x < 0 || originalStartNode.x >= landGrid.cols || originalStartNode.y < 0 || originalStartNode.y >= landGrid.rows ||
            originalEndNode.x < 0 || originalEndNode.x >= landGrid.cols || originalEndNode.y < 0 || originalEndNode.y >= landGrid.rows) {
            console.error("Start or end node is out of grid bounds.");
            return null;
        }

        const isStartOnLand = landGrid.grid[originalStartNode.x][originalStartNode.y] === 1;
        const isEndOnLand = landGrid.grid[originalEndNode.x][originalEndNode.y] === 1;

        let pathFromStart = [];
        let pathToEnd = [];
        let aStarStartNode = originalStartNode;
        let aStarEndNode = originalEndNode;

        // If starting on land, find path to nearest water
        if (isStartOnLand) {
            const startWaterInfo = this.findPathToNearestWater(originalStartNode, landGrid);
            if (!startWaterInfo) {
                console.error("Could not find a path from start to water.");
                return null;
            }
            pathFromStart = startWaterInfo.path;
            aStarStartNode = startWaterInfo.waterNode;
        }

        if (isEndOnLand) {
            const endWaterInfo = this.findPathToNearestWater(originalEndNode, landGrid);
            if (!endWaterInfo) {
                console.error("Could not find a path from destination to water.");
                return null;
            }
            // This path is from land to water, so we'll reverse it later to go from water to land.
            pathToEnd = endWaterInfo.path;
            aStarEndNode = endWaterInfo.waterNode;
        }

        // Run the main A* algorithm between the water-accessible points
        const waterPathResult = this.runAStar(aStarStartNode, aStarEndNode, landGrid, params);

        if (!waterPathResult) {
            console.error("A* failed to find a path between water points.");
            return null;
        }

        // Reconstruct and format the main sea path
        const waterPath = this.reconstructAndFormatPath(waterPathResult, landGrid, 0); // Start fuel at 0 for this segment

        // Combine the paths
        let finalPath = [];

        // Add the path from the land start to the water
        if (pathFromStart.length > 0) {
            finalPath = finalPath.concat(pathFromStart);
            // Avoid duplicating the connection point
            if (waterPath.length > 0) finalPath.pop();
        }

        // Add the main water path
        finalPath = finalPath.concat(waterPath);

        // Add the path from the water to the land end
        if (pathToEnd.length > 0) {
            // Avoid duplicating the connection point
            if(finalPath.length > 0) pathToEnd.shift();
            finalPath = finalPath.concat(pathToEnd.reverse());
        }
        
        // Recalculate total fuel consumption for the entire combined path
        return this.recalculateTotalFuel(finalPath, landGrid, params);
    }

    /**
     * The core A* algorithm for finding a path between two nodes.
     * @param {object} startNode - The starting grid node.
     * @param {object} endNode - The ending grid node.
     * @param {NavigationGrid} landGrid - The grid.
     * @param {object} params - Vessel and environmental parameters.
     * @returns {object|null} The final node with parent references, or null.
     */
    runAStar(startNode, endNode, landGrid, params) {
        const openSet = new MinHeap();
        const closedSet = new Set();
        const gScores = new Map(); // gScore is total fuel consumed in Liters

        const startKey = `${startNode.x},${startNode.y}`;
        gScores.set(startKey, 0);

        const initialHeuristic = this.heuristic(startNode, endNode, landGrid, params);
        openSet.push({ ...startNode, g: 0, h: initialHeuristic, f: initialHeuristic, parent: null });

        while (openSet.size() > 0) {
            let currentNode = openSet.pop();
            const currentKey = `${currentNode.x},${currentNode.y}`;
            if (closedSet.has(currentKey)) continue;
            if (currentNode.x === endNode.x && currentNode.y === endNode.y) {
                return currentNode; // Return the end node to be reconstructed
            }

            closedSet.add(currentKey);

            const neighbors = this.getNeighbors(currentNode, landGrid);
            for (const neighbor of neighbors) {
                const neighborKey = `${neighbor.x},${neighbor.y}`;
                if (closedSet.has(neighborKey)) continue;

                const isNeighborLand = landGrid.grid[neighbor.x][neighbor.y] === 1;
                // Allow moving onto land only if it's the final destination of this A* segment
                const isNeighborDestination = neighbor.x === endNode.x && neighbor.y === endNode.y;

                if (isNeighborLand && !isNeighborDestination) {
                    continue;
                }

                const fuelForSegment = this.calculateSegmentCost(currentNode, neighbor, landGrid, params);
                const gScore = currentNode.g + fuelForSegment;

                if (!gScores.has(neighborKey) || gScore < gScores.get(neighborKey)) {
                    gScores.set(neighborKey, gScore);
                    neighbor.parent = currentNode;
                    neighbor.g = gScore;
                    neighbor.h = this.heuristic(neighbor, endNode, landGrid, params);
                    neighbor.f = neighbor.g + neighbor.h;
                    openSet.push(neighbor);
                }
            }
        }
        return null; // No path found
    }

    /**
     * Finds the shortest path from a land node to the nearest water node using BFS.
     * @param {object} startNode - The starting land node.
     * @param {NavigationGrid} landGrid - The grid.
     * @returns {{path: Array<object>, waterNode: object}|null}
     */
    findPathToNearestWater(startNode, landGrid) {
        const queue = [{ ...startNode, parent: null }];
        const visited = new Set([`${startNode.x},${startNode.y}`]);

        while (queue.length > 0) {
            const currentNode = queue.shift();

            // Check if the current node is water
            if (landGrid.grid[currentNode.x][currentNode.y] === 0) {
                // Found water, reconstruct the path back to the start
                const path = [];
                let temp = currentNode;
                while (temp) {
                    path.push({
                        ...landGrid.gridToLatLng(temp.x, temp.y),
                        onLand: landGrid.grid[temp.x][temp.y] === 1,
                        totalFuel: 0 // Fuel is not calculated for this part
                    });
                    temp = temp.parent;
                }
                return { path: path.reverse(), waterNode: currentNode };
            }

            // Explore neighbors
            const neighbors = this.getNeighbors(currentNode, landGrid);
            for (const neighbor of neighbors) {
                const neighborKey = `${neighbor.x},${neighbor.y}`;
                if (!visited.has(neighborKey)) {
                    visited.add(neighborKey);
                    neighbor.parent = currentNode;
                    queue.push(neighbor);
                }
            }
        }
        return null; // No path to water found
    }
    
    /**
     * Reconstructs a path from the final A* node and formats it.
     * @param {object} endNode - The final node from the A* search.
     * @param {NavigationGrid} landGrid - The grid.
     * @param {number} initialFuel - The starting fuel value for this path segment.
     * @returns {Array<object>} The formatted path.
     */
    reconstructAndFormatPath(endNode, landGrid, initialFuel = 0) {
        let path = [];
        let temp = endNode;
        while (temp) {
            path.push({
                ...landGrid.gridToLatLng(temp.x, temp.y),
                onLand: landGrid.grid[temp.x][temp.y] === 1,
                totalFuel: initialFuel + temp.g // Add initial fuel to segment's gScore
            });
            temp = temp.parent;
        }
        return path.reverse();
    }


    /**
     * Recalculates the total fuel consumption for the final combined path.
     * @param {Array<object>} path - The complete path from start to end.
     * @param {NavigationGrid} landGrid - The grid.
     * @param {object} params - Vessel and environmental parameters.
     * @returns {Array<object>} The path with updated totalFuel values.
     */
    recalculateTotalFuel(path, landGrid, params) {
        if (path.length < 2) return path;

        let cumulativeFuel = 0;
        path[0].totalFuel = 0;

        for (let i = 1; i < path.length; i++) {
            const fromNode = landGrid.latLngToGrid(path[i - 1]);
            const toNode = landGrid.latLngToGrid(path[i]);
            const segmentFuel = this.calculateSegmentCost(fromNode, toNode, landGrid, params);
            cumulativeFuel += segmentFuel;
            path[i].totalFuel = cumulativeFuel;
        }

        return path;
    }


    // The core function for calculating fuel cost with environmental factors
    calculateSegmentCost(fromNode, toNode, grid, params) {
        const baseFuelPerKm = this.calculateFuelPerKm(params);
        const distanceKm = this.calculateDistance(fromNode, toNode, grid);

        // If distance is zero, cost is zero
        if (distanceKm === 0) return 0;

        let costMultiplier = 1.0;

        // --- Directional Factors (Wind, Current, Waves) ---
        const boatBearing = this.calculateBearing(fromNode, toNode, grid);
        
        // Wind Effect
        const windAngleDiff = Math.abs(boatBearing - params.windDirection);
        const windEffect = params.windStrength * Math.cos(windAngleDiff * Math.PI / 180);
        
        // Current Effect
        const currentAngleDiff = Math.abs(boatBearing - params.currentDirection);
        const currentEffect = params.currentStrength * Math.cos(currentAngleDiff * Math.PI / 180);

        // Wave Effect
        const waveAngleDiff = Math.abs(boatBearing - params.waveDirection);
        const waveEffect = params.waveHeight * Math.cos(waveAngleDiff * Math.PI / 180);
        
        costMultiplier -= (windEffect * 0.1); 
        costMultiplier -= (currentEffect * 0.2);
        costMultiplier += (waveEffect * 0.15);

        // --- Non-Directional Factors ---
        costMultiplier += (params.rainIntensity * params.rainProbability * 0.05);

        if (params.seaDepth < params.draft * 2) {
            costMultiplier += 0.3;
        }

        // Penalty for traveling over land (e.g., canals, ports)
        if (grid.grid[toNode.x][toNode.y] === 1) {
            costMultiplier *= 10; // Make land travel very expensive but possible
        }

        return baseFuelPerKm * distanceKm * Math.max(0.1, costMultiplier);
    }
    
    calculateFuelPerKm(params) {
        const { speed, hpReq, fuelRate, k, baseWeight, load, F, S } = params;
        const speedKmh = speed * 1.852;

        
        if (speedKmh <= 0) return Infinity;
        const fuelPerKm = (((hpReq * 0.62) * fuelRate * (1 + k * (load / baseWeight)) * F * S) / speedKmh);
        return fuelPerKm;
    }

    heuristic(a, b, grid, params) {
        const distanceKm = this.calculateDistance(a, b, grid);
        return this.calculateFuelPerKm(params) * distanceKm;
    }

    calculateDistance(a, b, grid) {
        const R = 6371; // Earth's radius in km
        const p1 = grid.gridToLatLng(a.x, a.y);
        const p2 = grid.gridToLatLng(b.x, b.y);

        const radLat1 = p1.lat * Math.PI / 180;
        const radLat2 = p2.lat * Math.PI / 180;
        const dLat = (p2.lat - p1.lat) * Math.PI / 180;
        const dLon = (p2.lng - p1.lng) * Math.PI / 180;

        const val = Math.sin(dLat/2) * Math.sin(dLat/2) +
                  Math.cos(radLat1) * Math.cos(radLat2) *
                  Math.sin(dLon/2) * Math.sin(dLon/2);
        const c = 2 * Math.atan2(Math.sqrt(val), Math.sqrt(1-val)); 
        return R * c;
    }

    calculateBearing(a, b, grid) {
        const p1 = grid.gridToLatLng(a.x, a.y);
        const p2 = grid.gridToLatLng(b.x, b.y);

        const lat1 = p1.lat * Math.PI / 180;
        const lng1 = p1.lng * Math.PI / 180;
        const lat2 = p2.lat * Math.PI / 180;
        const lng2 = p2.lng * Math.PI / 180;
        
        const y = Math.sin(lng2 - lng1) * Math.cos(lat2);
        const x = Math.cos(lat1) * Math.sin(lat2) - Math.sin(lat1) * Math.cos(lat2) * Math.cos(lng2 - lng1);
        let brng = Math.atan2(y, x) * 180 / Math.PI;
        return (brng + 360) % 360;
    }

    getNeighbors(node, grid) {
        const neighbors = [];
        const { x, y } = node;
        const { cols, rows } = grid;

        for (let i = -1; i <= 1; i++) {
            for (let j = -1; j <= 1; j++) {
                if (i === 0 && j === 0) continue;
                const newY = y + j;
                if (newY < 0 || newY >= rows) continue;
                const newX = (x + i + cols) % cols;
                if (i !== 0 && j !== 0) {
                    const adjacentX1 = (x + i + cols) % cols;
                    const adjacentX2 = x;
                    const adjacentY1 = y;
                    const adjacentY2 = y + j;
                    if (grid.grid[adjacentX1][adjacentY1] === 1 && grid.grid[adjacentX2][adjacentY2] === 1) {
                        continue;
                    }
                }
                neighbors.push({ x: newX, y: newY });
            }
        }
        return neighbors;
    }
}

module.exports = AStarPathfinder;