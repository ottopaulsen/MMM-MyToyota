"use strict";

const NodeHelper = require("node_helper");
const dns = require("dns").promises;
const { MyToyota, ToyotaLoginError } = require("./mytoyota");

const API_HOST = "ctpa-oneapi.tceu-ctp-prd.toyotaconnectedeurope.io";

function set(carData, key, label, value, suffix = "") {
  if (value === null || value === undefined || value === "") return;
  carData.set(key, { label, value, suffix });
}

function num(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

// Toyota reports distances as { value, unit }. Normalise to kilometres.
function toKm(unitValue) {
  if (!unitValue) return null;
  const value = num(unitValue.value !== undefined ? unitValue.value : unitValue);
  if (value === null) return null;
  const unit = String(unitValue.unit || "km").toLowerCase();
  if (unit === "mi" || unit === "miles") return Math.round(value * 1.609344);
  if (unit === "m" || unit === "metres" || unit === "meters") return Math.round(value / 1000);
  return Math.round(value);
}

/*
 * Flatten Toyota's several endpoints into the flat carData map the front-end
 * understands. Every field is optional: which of them exist depends on the
 * model, and on whether it is battery electric, plug-in or a plain hybrid.
 */
function mapToCarData(data, carData) {
  const { electric, telemetry, location, status } = data;

  if (electric) {
    const battery = num(electric.batteryLevel);
    if (battery !== null) set(carData, "battery", "Battery level", Math.round(battery), "%");

    // A PHEV reports the usable part separately; prefer it when present.
    const usable = num(electric.phevUsableBatteryLevel);
    if (usable !== null) set(carData, "battery", "Battery level", Math.round(usable), "%");

    const evRange = toKm(electric.evRange);
    if (evRange !== null) set(carData, "range", "Range", evRange, "km");

    const fuelRange = toKm(electric.fuelRange);
    if (fuelRange !== null) set(carData, "fuelRange", "Fuel range", fuelRange, "km");

    const fuel = num(electric.fuelLevel);
    if (fuel !== null) set(carData, "fuel", "Fuel level", Math.round(fuel), "%");

    if (electric.chargingStatus) {
      const s = String(electric.chargingStatus).toLowerCase();
      const charging = s.includes("charging") && !s.includes("not") && !s.includes("none");
      set(carData, "charging", "Charging", charging ? "CHARGING" : "NOT_CHARGING");
    }

    const remaining = num(electric.remainingChargeTime);
    if (remaining !== null && remaining > 0) {
      set(carData, "chargingRemainingHour", "Remaining hours", Math.floor(remaining / 60), "h");
      set(carData, "chargingRemainingMinute", "Remaining minutes", remaining % 60, "m");
    }

    if (electric.lastUpdateTimestamp) {
      set(carData, "lastDatasetTime", "Last update", electric.lastUpdateTimestamp);
    }
  }

  if (telemetry) {
    const odo = toKm(telemetry.odometer);
    if (odo !== null) set(carData, "distanceCovered", "Odometer", odo, "km");

    if (carData.get("fuel") === undefined) {
      const fuel = num(telemetry.fuelLevel);
      if (fuel !== null) set(carData, "fuel", "Fuel level", Math.round(fuel), "%");
    }
    if (carData.get("range") === undefined) {
      const range = toKm(telemetry.distanceToEmpty);
      if (range !== null) set(carData, "range", "Range", range, "km");
    }
  }

  if (location && location.vehicleLocation) {
    const lat = num(location.vehicleLocation.latitude);
    const lon = num(location.vehicleLocation.longitude);
    if (lat !== null) set(carData, "latitude", "Latitude", lat);
    if (lon !== null) set(carData, "longitude", "Longitude", lon);
    if (!carData.has("lastDatasetTime") && location.lastTimestamp) {
      set(carData, "lastDatasetTime", "Last update", location.lastTimestamp);
    }
  }

  if (status) {
    // Toyota reports component state as { status, lastUpdateTimestamp }.
    // Locked only if every door that reports a lock status says locked; the
    // hood reports openStatus only, so it is skipped here.
    const doors = status.doors || {};
    const lockStates = Object.values(doors)
      .map((d) => d && d.lockStatus && d.lockStatus.status)
      .filter((v) => v !== undefined && v !== null);
    if (lockStates.length) {
      const locked = lockStates.every((v) => String(v).toLowerCase() === "locked");
      set(carData, "lockState", "Lock state", locked ? "LOCKED" : "UNLOCKED");
    }

    const openStates = Object.values(doors)
      .map((d) => d && d.openStatus && d.openStatus.status)
      .filter((v) => v !== undefined && v !== null);
    if (openStates.length) {
      const anyOpen = openStates.some((v) => String(v).toLowerCase() !== "close");
      set(carData, "doorState", "Doors", anyOpen ? "OPEN" : "CLOSED");
    }

    const windows = status.windows || {};
    const windowStates = Object.values(windows)
      .map((w) => w && w.status)
      .filter((v) => v !== undefined && v !== null);
    if (windowStates.length) {
      const anyOpen = windowStates.some((v) => String(v).toLowerCase() !== "close");
      set(carData, "windowState", "Windows", anyOpen ? "OPEN" : "CLOSED");
    }
  }
}

module.exports = NodeHelper.create({
  start() {
    console.log(this.name + ": Starting node helper");
    this.api = null;
    this.config = null;
    this.vin = null;
    this.carData = new Map();
    this.timer = null;
    this._loginFailureLogged = false;
  },

  stop() {
    clearTimeout(this.timer);
    this.timer = null;
  },

  log(...args) {
    if (this.config && this.config.logging) console.log(...args);
  },

  socketNotificationReceived(notification, payload) {
    if (notification !== "MYTOYOTA_CONFIG") return;
    this.config = payload;
    // The front-end re-sends its config on every browser refresh; without this
    // each refresh would start another poll loop alongside the first.
    clearTimeout(this.timer);
    this.timer = null;
    this.readData();
  },

  schedule(delayMs) {
    clearTimeout(this.timer);
    this.timer = setTimeout(() => this.readData(), delayMs);
  },

  intervalMs() {
    const seconds = Number(this.config && this.config.refreshIntervalSeconds);
    if (!Number.isFinite(seconds) || seconds < 60) return 15 * 60 * 1000;
    return seconds * 1000;
  },

  async initApi() {
    if (this.api) return;
    const { username, password } = this.config;
    if (!username || !password) {
      throw new ToyotaLoginError(
        "No username/password configured - add username and password to your MMM-MyToyota config"
      );
    }
    this.api = new MyToyota(username, password, (...a) => this.log(...a));
  },

  async resolveVin() {
    if (this.vin) return this.vin;
    if (this.config.vin) {
      this.vin = this.config.vin;
      return this.vin;
    }
    const vehicles = await this.api.listVehicles();
    if (!vehicles.length) throw new Error("No vehicles found on this MyToyota account");
    if (vehicles.length > 1) {
      const vins = vehicles.map((v) => v.vin).filter(Boolean).join(", ");
      console.log(this.name + `: Multiple vehicles found (${vins}). Using the first. Add 'vin' to config to pick one.`);
    }
    this.vin = vehicles[0].vin;
    console.log(this.name + ": Using VIN " + this.vin);
    return this.vin;
  },

  async readData() {
    const online = await dns.lookup(API_HOST).then(() => true).catch(() => false);
    if (!online) {
      console.log(this.name + ": No internet available");
      set(this.carData, "apiConnection", "API Connection", "NO INTERNET");
      this.publish();
      this.schedule(60 * 1000);
      return;
    }

    try {
      await this.initApi();
      const vin = await this.resolveVin();

      // Only the electric/telemetry read is essential; the rest are best effort
      // so one failing endpoint cannot blank the whole display.
      const [electric, telemetry, location, status] = await Promise.all([
        this.api.getElectricStatus(vin).catch((e) => { this.log(this.name + ": electric: " + e.message); return null; }),
        this.api.getTelemetry(vin).catch((e) => { this.log(this.name + ": telemetry: " + e.message); return null; }),
        this.config.showPosition === false
          ? null
          : this.api.getLocation(vin).catch((e) => { this.log(this.name + ": location: " + e.message); return null; }),
        this.api.getStatus(vin).catch((e) => { this.log(this.name + ": status: " + e.message); return null; })
      ]);

      if (!electric && !telemetry && !location && !status) {
        throw new Error("All Toyota endpoints failed");
      }

      this.log(this.name + ": raw data\n" + JSON.stringify({ electric, telemetry, location, status }, null, 2));
      mapToCarData({ electric, telemetry, location, status }, this.carData);
      set(this.carData, "apiConnection", "API Connection", "OK");
      this._loginFailureLogged = false;
    } catch (error) {
      if (error instanceof ToyotaLoginError) {
        if (!this._loginFailureLogged) {
          console.error(this.name + ": Login problem: " + error.message);
          this._loginFailureLogged = true;
        }
        set(this.carData, "apiConnection", "API Connection", "LOGIN_FAILED");
        // Drop the client so the next attempt starts a clean login.
        this.api = null;
      } else {
        console.error(this.name + ": Error reading car data: " + (error.message || error));
        set(this.carData, "apiConnection", "API Connection", "ERROR");
      }
    }

    this.publish();
    this.schedule(this.intervalMs());
  },

  publish() {
    this.sendSocketNotification("MYTOYOTA_CARDATA", JSON.stringify([...this.carData.entries()]));
  }
});
