# data_server.py
# A high-performance FastAPI server to provide environmental data.

import sys
from fastapi import FastAPI
from pydantic import BaseModel, Field
import netCDF4
import numpy as np
from datetime import datetime, timedelta
import os
from contextlib import asynccontextmanager

# --- Configuration ---
BASE_NC_PATH = "nc_data"

# --- FastAPI App Initialization ---
app = FastAPI()
data_cache = { "nc_files": {} }

# --- Data Models ---
class GridDataRequest(BaseModel):
    # This is the corrected model
    min_lat: float 
    min_lon: float
    max_lat: float
    max_lon: float
    date: str
# --- Lifespan Management ---
@asynccontextmanager
async def lifespan(app: FastAPI):
    print("--- FastAPI server starting up: Loading NetCDF files... ---")
    nc_filenames = ["wind_asc.nc", "wind_dsc.nc", "current.nc", "waves.nc", "rain.nc", "ice.nc", "sea_depth.nc"]
    for filename in nc_filenames:
        try:
            path = os.path.join(BASE_NC_PATH, filename)
            data_cache["nc_files"][filename] = netCDF4.Dataset(path, 'r')
            print(f"  - Successfully loaded and cached: {path}")
        except Exception as e:
            print(f"  - WARNING: Could not load {filename}. Error: {e}")
    print("--- Data loading complete. Server is ready. ---")
    yield
    print("--- Closing all open data files... ---")
    for handler in data_cache["nc_files"].values(): handler.close()
    print("--- Server shut down. ---")

app.router.lifespan_context = lifespan

# --- API Endpoint ---
@app.post("/get-data-grid/")
async def get_data_grid(request: GridDataRequest):
    response_data = {}
    try:
        voyage_date = datetime.fromisoformat(request.date.replace('Z', '+00:00'))
        days_since_sunday = (voyage_date.weekday() + 1) % 7
        target_date = voyage_date - timedelta(days=days_since_sunday)

        lon_crosses_dateline = request.min_lon > request.max_lon

        for nc_name, nc_handler in data_cache["nc_files"].items():
            lat_var = nc_handler.variables.get('lat') or nc_handler.variables.get('latitude')
            lon_var = nc_handler.variables.get('lon') or nc_handler.variables.get('longitude')
            
            lat_indices = np.where((lat_var[:] >= request.min_lat) & (lat_var[:] <= request.max_lat))[0]
            if len(lat_indices) == 0: continue
            lat_slice = slice(lat_indices.min(), lat_indices.max() + 1)
            
            if 'lats' not in response_data:
                response_data['lats'] = lat_var[lat_slice].tolist()

            if lon_crosses_dateline:
                lon_indices1 = np.where(lon_var[:] >= request.min_lon)[0]
                lon_indices2 = np.where(lon_var[:] <= request.max_lon)[0]
                lon_indices = np.concatenate([lon_indices1, lon_indices2])
            else:
                lon_indices = np.where((lon_var[:] >= request.min_lon) & (lon_var[:] <= request.max_lon))[0]
            
            if len(lon_indices) == 0: continue
            
            if 'lons' not in response_data:
                if lon_crosses_dateline:
                     response_data['lons'] = np.concatenate([lon_var[lon_indices1], lon_var[lon_indices2]]).tolist()
                else:
                    lon_slice = slice(lon_indices.min(), lon_indices.max() + 1)
                    response_data['lons'] = lon_var[lon_slice].tolist()

            time_idx = 0
            if 'time' in nc_handler.variables:
                time_var = nc_handler.variables['time']
                time_dates = netCDF4.num2date(time_var[:], time_var.units, calendar=getattr(time_var, 'calendar', 'standard'), only_use_cftime_datetimes=False, only_use_python_datetimes=True)
                time_diffs = np.array([abs(d.replace(tzinfo=None) - target_date.replace(tzinfo=None)) for d in time_dates])
                time_idx = time_diffs.argmin()

            for var_name in nc_handler.variables:
                if var_name in ['lat', 'lon', 'latitude', 'longitude', 'time']: continue
                
                variable = nc_handler.variables[var_name]
                data_slice = None

                if variable.ndim == 3: # (time, lat, lon)
                    if lon_crosses_dateline:
                        data1 = variable[time_idx, lat_slice, lon_indices1]; data2 = variable[time_idx, lat_slice, lon_indices2]
                        data_slice = np.concatenate([data1, data2], axis=1)
                    else:
                        lon_slice = slice(lon_indices.min(), lon_indices.max() + 1)
                        data_slice = variable[time_idx, lat_slice, lon_slice]
                elif variable.ndim == 2: # (lat, lon)
                    if lon_crosses_dateline:
                        data1 = variable[lat_slice, lon_indices1]; data2 = variable[lat_slice, lon_indices2]
                        data_slice = np.concatenate([data1, data2], axis=1)
                    else:
                        lon_slice = slice(lon_indices.min(), lon_indices.max() + 1)
                        data_slice = variable[lat_slice, lon_slice]

                if data_slice is not None:
                    if var_name == 'elevation':
                        data_slice[data_slice > 0] = 0; data_slice *= -1
                        var_name = 'depth'
                    
                    # Fill masked data with -9999 as expected by the new cache
                    if np.ma.is_masked(data_slice):
                        data_slice = data_slice.filled(-9999)

                    response_data[var_name] = data_slice.tolist()
    except Exception as e:
        print(f"Error processing grid request: {e}", file=sys.stderr)
        return {"error": str(e)}
    print(f"DEBUG: Returning response with keys: {list(response_data.keys())}")
    return response_data