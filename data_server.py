#!/usr/bin/env python3
"""
data_server.py

A lightweight Flask-based API server to serve data slices from NetCDF files on demand.
This is extremely memory-efficient as it only reads the required data from disk
for each request, never loading the entire files into memory.

Requirements:
    pip install flask xarray netcdf4 pandas

Usage:
    python3 data_server.py
"""

from flask import Flask, request, jsonify
import xarray as xr
import os
import numpy as np
import pandas as pd

app = Flask(__name__)

# --- Configuration ---
# This must point to your folder of regridded, aligned NetCDF files.
NC_DATA_DIR = 'nc_data_regridded' 
datasets = {}

def load_datasets():
    """Loads references to all NetCDF files without loading data into memory."""
    print("Loading dataset references...")
    file_map = {
        'wind_asc': 'wind_asc.nc',
        'wind_dsc': 'wind_dsc.nc',
        'current': 'current.nc',
        'waves': 'waves.nc',
        'rain': 'rain.nc',
        'ice': 'ice.nc'
    }
    for key, filename in file_map.items():
        path = os.path.join(NC_DATA_DIR, filename)
        if os.path.exists(path):
            # chunks={} prevents xarray from loading data into memory immediately
            datasets[key] = xr.open_dataset(path, chunks={})
            print(f"  -> Opened reference to {filename}")
        else:
            print(f"  -> WARNING: File not found for '{key}' at {path}")
    print("Dataset references loaded.")

def cardinal_to_angle_rad(cardinal):
    angle_deg = 90 - (cardinal * 45)
    return np.deg2rad(angle_deg)

def angle_rad_to_cardinal(angle_rad):
    angle_deg = np.rad2deg(angle_rad)
    angle_deg = (angle_deg % 360 + 360) % 360
    cardinal_float = (90 - angle_deg) / 45
    return np.round((cardinal_float % 8 + 8) % 8).astype(int)

@app.route('/get_data', methods=['GET'])
def get_data():
    """API endpoint to get environmental data for a specific point in space and time."""
    try:
        lat = float(request.args.get('lat'))
        lon = float(request.args.get('lon'))
        time_ms_str = request.args.get('time')

        # --- FIX: Robustly handle potential 'NaN' or invalid time values ---
        if not time_ms_str or time_ms_str == 'NaN':
            raise ValueError("Invalid time value received.")
        
        time_ms = int(float(time_ms_str))
        time_dt = pd.to_datetime(time_ms, unit='ms')

        # --- Wind Data (Vector Average) ---
        ds_asc = datasets.get('wind_asc')
        ds_dsc = datasets.get('wind_dsc')
        
        data_asc = ds_asc.sel(lat=lat, lon=lon, time=time_dt, method='nearest')
        data_dsc = ds_dsc.sel(lat=lat, lon=lon, time=time_dt, method='nearest')

        speed_asc = data_asc['wind_speed_mps_asc'].item(0)
        card_asc = data_asc['wind_cardinal_asc'].item(0)
        speed_dsc = data_dsc['wind_speed_mps_dsc'].item(0)
        card_dsc = data_dsc['wind_cardinal_dsc'].item(0)
        
        angle_asc = cardinal_to_angle_rad(card_asc)
        angle_dsc = cardinal_to_angle_rad(card_dsc)
        x_asc = speed_asc * np.cos(angle_asc)
        y_asc = speed_asc * np.sin(angle_asc)
        x_dsc = speed_dsc * np.cos(angle_dsc)
        y_dsc = speed_dsc * np.sin(angle_dsc)
        x_avg = (x_asc + x_dsc) / 2
        y_avg = (y_asc + y_dsc) / 2
        final_wind_speed = np.sqrt(x_avg**2 + y_avg**2)
        final_angle = np.arctan2(y_avg, x_avg)
        final_wind_cardinal = angle_rad_to_cardinal(final_angle)

        # --- Other Data ---
        env_data = {
            'wind_speed_mps': final_wind_speed,
            'wind_cardinal': final_wind_cardinal,
            'current_speed_mps': datasets['current']['current_speed_mps'].sel(lat=lat, lon=lon, time=time_dt, method='nearest').item(0),
            'current_cardinal': datasets['current']['current_cardinal'].sel(lat=lat, lon=lon, time=time_dt, method='nearest').item(0),
            'waves_height_m': datasets['waves']['waves_height'].sel(lat=lat, lon=lon, time=time_dt, method='nearest').item(0),
            'weekly_precip_mean': datasets['rain']['precipitation'].sel(lat=lat, lon=lon, time=time_dt, method='nearest').item(0),
            'ice_conc': datasets['ice']['ice_conc'].sel(lat=lat, lon=lon, time=time_dt, method='nearest').item(0)
        }
        
        # Replace any NaN values with 0 for safety
        for key, value in env_data.items():
            if np.isnan(value):
                env_data[key] = 0

        return jsonify(env_data)

    except Exception as e:
        print(f"Error in /get_data: {e}")
        return jsonify({"error": str(e)}), 500

if __name__ == '__main__':
    load_datasets()
    # Runs on localhost, port 5000
    app.run(debug=False, port=5000)
