
Module.register("MMM-MyToyota", {

    getScripts: function () {
        return [
            // svg.js 2.7.1 (MIT), vendored so the module has no install step.
            // Swap for node_modules/svg.js/dist/svg.js if you prefer npm.
            this.file('vendor/svg.js'),
        ];
    },

    getTranslations: function () {
        return {
            en: "translations/en.json",
            nb: "translations/nb.json"
        }
    },

    // Default module config
    defaults: {
        // MyToyota account. Same credentials as the phone app.
        username: "",
        password: "",
        // Optional. Only needed if the account has more than one car;
        // otherwise the first vehicle on the account is used.
        vin: "",

        // Toyota's servers update roughly every 15 minutes, and polling
        // harder does not produce fresher data.
        refreshIntervalSeconds: 900,
        // Which car drawing to use. See carImages at the bottom of this file;
        // add an entry there to offer another one.
        image: "Default",
        size: 300,
        showDistance: true,
        showPosition: true,
        showBatteryPercent: true,
        showRange: true,
        showConnectionStatus: true,
        showDriving: true,
        showBattery: true,
        logging: false,
        colors: {
            car: "gray",
            text: "#ccc",
            rangeText: "black",
            chargingSign: "yellow",
            lightsOn: "yellow",
            lightsOff: "#222",
            wheels: "#222"
        },
        batteryColors: [
            { upTo: 20, background: "pink", forground: "red", text: "yellow" },
            { upTo: 50, background: "pink", forground: "orange", text: "yellow" },
            { upTo: 75, background: "#666", forground: "blue", text: "yellow" },
            { upTo: 100, background: "#666", forground: "green", text: "yellow" }
        ],
        positions: [
            { name: "Hjemme", lat: 63.430484, lon: 10.394966, marginMeters: 50 },
            { name: "Trondheim Spektrum", lat: 63.426559, lon: 10.376309, marginMeters: 100 },
            { name: "City Lade", lat: 63.444426, lon: 10.446577, marginMeters: 200 }
        ],
        homePosition: "Hjemme"
    },

    start: function () {
        console.log(this.name + ' started.');
        this.carData = [];
        this.loaded = true;
        this.sendSocketNotification('MYTOYOTA_CONFIG', this.config);
        // Refresh "time since last update" every 30 seconds
        setInterval(() => {
            if (this.carDrawing) {
                this.updateLastConnection(this.carDrawing, this.carData);
            }
        }, 30 * 1000);
    },

    log: function(...args) {
        if (this.config.logging) {
            console.log(args);
        }
    },

    socketNotificationReceived: function (notification, payload) {
        const self = this;
        if (notification === 'MYTOYOTA_CARDATA') {
            if (payload != null) {
                self.carData = JSON.parse(payload).reduce((m, [key, val]) => m.set(key, val), new Map());
                this.log('Parsed carData: ', self.carData);
                self.updateCar(self.carDrawing, self.carData, self.config);
            } else {
                console.log(self.name + ': MYTOYOTA_CARDATA - No payload');
            }
        }
    },

    getStyles: function () {
        return [
            'MMM-MyToyota.css'
        ];
    },

    drawingId: function () {
        return this.identifier + "_carDrawing";
    },

    getDom: function () {
        const self = this;
        const wrapper = document.createElement("div");
        const svgDiv = document.createElement("div");
        // Must be unique: MMM-WeConnect draws into an element called
        // "carDrawing" as well, and duplicate ids make SVG() pick the wrong one.
        svgDiv.setAttribute("id", this.drawingId());
        wrapper.appendChild(svgDiv);

        setTimeout(() => {
            this.carDrawing = this.drawCar(this.config);
        }, 100)
        return wrapper;
    },

    degreesToRadians: function (degrees) {
        return degrees * Math.PI / 180;
    },

    distanceInMetersBetweenEarthCoordinates: function (lat1, lon1, lat2, lon2) {
        const earthRadiusKm = 6371;

        const dLat = this.degreesToRadians(lat2 - lat1);
        const dLon = this.degreesToRadians(lon2 - lon1);

        lat1 = this.degreesToRadians(lat1);
        lat2 = this.degreesToRadians(lat2);

        const a = Math.sin(dLat / 2) * Math.sin(dLat / 2) +
            Math.sin(dLon / 2) * Math.sin(dLon / 2) * Math.cos(lat1) * Math.cos(lat2);
        const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
        return earthRadiusKm * c * 1000;
    },

    calculateAge: function (time) {
        const sec = Math.round((Date.now() - time) / 1000);
        if (sec < 45) return this.translate("NOW");
        const min = Math.round(sec / 60)
        if (min < 60) return min + ' ' + this.translate("MINUTES");
        const h = Math.round(min / 60)
        if (h < 24) return h + ' ' + this.translate("HOURS");
        const d = Math.round(h / 24)
        return d + ' ' + this.translate("DAYS");
    },

    findPosition: function (carData) {
        if (carData.has("driving")) {
            if (carData.get("driving").value == "YES") {
                return this.translate("DRIVING");
            }
        }
        if (!carData.has("latitude")) {
            return "No position";
        }
        if (!this.config.positions) {
            return "";
        }
        let distanceFromHome = "";
        let closestPosition = "";
        let closestDistance = 999999999;
        this.config.positions.forEach(configPos => {
            let distance = this.distanceInMetersBetweenEarthCoordinates(
                carData.get("latitude").value,
                carData.get("longitude").value,
                configPos.lat,
                configPos.lon
            );
            if (distance < closestDistance) {
                closestDistance = distance;
                if (distance < configPos.marginMeters) {
                    closestPosition = configPos.name;
                }
            }
            if (configPos.name == this.config.homePosition) {
                distanceFromHome = "" + Math.round(distance / 100) / 10 + " km " + this.translate("FROM HOME");
            }
        });
        return closestPosition || distanceFromHome || "";
    },

    // A do-nothing element, so a drawing need only build the parts it wants.
    // updateCar calls .hide()/.text()/.fill() on everything unconditionally.
    noElement: function () {
        const self = {};
        ["show", "hide", "text", "fill", "stroke", "move", "size", "width",
         "height", "attr", "radius", "center", "front", "back"].forEach((m) => {
            self[m] = () => self;
        });
        return self;
    },

    // Pick the drawing named by config.image, falling back to Default.
    drawCar: function (config) {
        const name = config.image || "Default";
        const draw = this.carImages[name] || this.carImages.Default;
        if (!this.carImages[name]) {
            console.log(this.name + ": unknown image '" + name + "', using Default");
        }
        return draw.call(this, config);
    },

    drawDefault: function (config) {
        const baseColor = config.colors.car;
        const textColor = config.colors.text;
        const batteryColor = config.colors.emptyBattery;
        const svg = SVG(this.drawingId()).size(config.size, config.size)
            .viewbox(0, 0, 400, 400);
        const car = svg.group()
            .attr('id', 'car');
        const leftWheel = car.rect(40, 60)
            .move(130, 200)
            .radius(10)
            .fill(config.colors.wheels)
            .stroke({ width: 3, color: baseColor })
            .attr('id', 'left_wheel');
        const rightWheel = car.rect(40, 60)
            .move(320, 200)
            .radius(10)
            .fill(config.colors.wheels)
            .stroke({ width: 3, color: baseColor })
            .attr('id', 'right_wheel');
        const body = car.path("M100 150 v80 h290 v-80 a30 30 0 0 0 -30 -30 h-230 a30 30 0 0 0 -30 30")
            .stroke({ width: 10, color: baseColor })
            .fill(baseColor)
            .attr('id', 'car_body');
        const top = car.path("M140 120 v-40 a30 30 0 0 1 30 -30 h150 a30 30 0 0 1 30 30 v40")
            .stroke({ width: 10, color: baseColor });
        const leftLight = svg.circle(40)
            .move(120, 140)
            .fill(config.colors.lightsOff)
            .attr('id', 'left_light');
        const rightLight = svg.circle(40)
            .move(330, 140)
            .fill(config.colors.lightsOff)
            .attr('id', 'right_light');
        const cableConnected = svg.path("M100 160 h-20 a15 15 0 0 1 -15 -15 v-60 a15 15 0 0 0 -15 -15 h-50")
            .stroke({ width: 8, color: baseColor })
            .hide()
            .attr('id', 'cable_connected');
        const cableDisConnected = svg.path("M0 70 h20 a15 15 0 0 1 15 15 v180 m-5 15 v-10 a5 5 0 0 1 10 0 v10")
            .stroke({ width: 8, color: baseColor })
            .hide()
            .attr('id', 'cable_disconnected');
        const chargerBox = svg.rect(15, 50)
            .move(0, 55)
            .radius(2)
            .fill(baseColor)
            .attr('id', 'charger_box');
        const wall = svg.line(0, 0, 0, 300)
            .stroke({ width: 1, color: baseColor })
            .attr('id', 'wall');
        const charging = svg.polygon("60,65 90,25 100,35 130,10 100,55 90,45")
            .fill("yellow")
            .rotate(-30)
            .hide()
            .attr('id', 'charging');
        const battery = svg.group()
            .attr('id', 'battery');
        const batteryBody = battery.rect(130, 60)
            .move(180, 162)
            .radius(10)
            .fill(batteryColor)
            .hide()
            .attr('id', 'battery_body');
        const batteryTop = battery.rect(12, 34)
            .move(310, 175)
            .radius(3)
            .fill(batteryColor)
            .hide()
            .attr('id', 'battery_top');
        const batteryLevel = batteryBody.clone()
            .attr('id', 'battery_level');
        const driver = svg.path("M195 120 a100 100 0 0 1 100 0")
            .stroke({ width: 10, color: baseColor })
            .fill(baseColor)
            .hide()
            .attr('id', 'driver');
        const driverHead = svg.circle(44)
            .center(245, 86)
            .fill(baseColor)
            .hide()
            .attr('id', 'driver_head');
        const antenna = svg.line(370, 120, 380, 10)
            .stroke({ width: 3, color: baseColor })
            .attr('id', 'antenna');
        const antennaTop = svg.circle(5)
            .center(380, 10)
            .fill(baseColor)
            .attr('id', 'antenna_top');

        const distance = svg.text("")
            .move(245, 230)
            .font({ size: 22, anchor: "middle", fill: textColor })
            .attr('id', 'distance');
        const batteryPercent = svg.text("")
            .move(245, 155)
            .font({ size: 40, anchor: "middle", fill: config.colors.batteryPercent })
            .attr('id', 'battery_percent');
        const range = svg.text("")
            .move(245, 110)
            .font({ size: 32, anchor: "middle", fill: config.colors.rangeText, weight: 600 })
            .attr('id', 'range');
        const remainingChargingTime = svg.text("")
            .move(10, -10)
            .font({ size: 24, anchor: "start", fill: textColor })
            .attr('id', 'remaining_charging_time');
        const position = svg.text("")
            .move(245, 280)
            .font({ size: 28, anchor: "middle", fill: textColor })
            .attr('id', 'position');
        const lastConnection = svg.text("MyToyota")
            .move(372, -10)
            .font({ size: 20, anchor: "end", fill: textColor })
            .attr('id', 'last_connection');
        const outsideTemp = svg.text("")
            .move(100, -10)
            .font({ size: 32, anchor: "start", fill: textColor })
            .hide()
            .attr('id', 'outside_temp');

        // Padlock — shown in car window when parked; green=locked, red=unlocked
        // Window center ≈ x=245, y=85 (viewbox 0 0 400 400)
        const lockGroup = svg.group().attr('id', 'lock_group').hide();
        const lockBody = lockGroup.rect(40, 26)
            .move(225, 88)
            .radius(6)
            .fill("#555")
            .attr('id', 'lock_body');
        // Keyhole
        lockGroup.circle(9).center(245, 99).fill("#333");
        lockGroup.rect(5, 7).move(243, 103).fill("#333");
        // Locked shackle: both legs in body (full U), short arc
        const lockShackleLocked = lockGroup.path("M234,88 v-12 a11,11 0 0 1 22,0 v12")
            .stroke({ width: 6, color: "#888" })
            .fill("none")
            .attr('id', 'lock_shackle_locked');
        // Unlocked shackle: left leg in body, right leg raised free
        const lockShackleOpen = lockGroup.path("M234,88 v-12 a11,11 0 0 1 22,0")
            .stroke({ width: 6, color: "#888" })
            .fill("none")
            .hide()
            .attr('id', 'lock_shackle_open');

        if (!config.showConnectionStatus) lastConnection.hide();
        if (!config.showBattery) battery.hide();

        return {
            svg,
            body,
            top,
            leftLight,
            rightLight,
            leftWheel,
            rightWheel,
            cableConnected,
            cableDisConnected,
            chargerBox,
            wall,
            charging,
            distance,
            battery,
            batteryBody,
            batteryTop,
            batteryLevel,
            batteryPercent,
            range,
            remainingChargingTime,
            position,
            driver,
            driverHead,
            lastConnection,
            outsideTemp,
            lockGroup,
            lockBody,
            lockShackleLocked,
            lockShackleOpen,
            antenna,
            antennaTop
        }
    },

    /*
     * "Touring" — a bZ4X Touring seen from the side, facing left.
     *
     * Proportions taken off a factory side-on photo rather than from memory:
     *   length : height          about 2.8 : 1
     *   wheel diameter           about 43% of overall height
     *   wheelbase                0.18 to 0.80 of the length
     *   glass                    shallow, roughly a third of the body height
     * The defining features are the big squared black wheel-arch flares and
     * the sill cladding, the nose dropping steeply to a low pointed bumper,
     * and a raked tailgate with a roof spoiler. Roof rails stand proud.
     *
     * Laid out in the 400x400 viewbox; unrelated to drawDefault's positions.
     */
    drawTouring: function (config) {
        const baseColor = config.colors.car;
        const textColor = config.colors.text;
        const darkColor = config.colors.wheels;
        // Arches are cut by painting the background over the body, so this
        // has to match what the mirror sits on.
        const bg = config.colors.background || "black";
        const svg = SVG(this.drawingId()).size(config.size, config.size)
            .viewbox(0, 0, 400, 400);

        const NOSE = 12, TAIL = 388;
        const ROOF = 164, BELT = 210, SILL = 284, GROUND = 300;
        const WHEEL_R = 29, AXLE_Y = GROUND - WHEEL_R;
        const FRONT_X = 82, REAR_X = 312;
        const FLARE_R = WHEEL_R + 14;

        // Charging point, left of the car, behind the body.
        const wall = svg.rect(9, 120).move(0, 180).fill(darkColor).hide();
        const chargerBox = svg.rect(22, 32).move(-8, 210).radius(4)
            .fill(baseColor).stroke({ width: 2, color: darkColor }).hide();
        const cableConnected = svg.path("M14 242 C 14 292, 28 296, 28 258")
            .fill("none").stroke({ width: 5, color: config.colors.chargingSign }).hide();
        const cableDisConnected = svg.path("M14 242 C 14 288, 22 296, 16 306")
            .fill("none").stroke({ width: 5, color: darkColor }).hide();

        const car = svg.group().attr("id", "car");

        // Roof rails, standing proud of the roof.
        car.rect(168, 6).move(166, ROOF - 12).radius(3).fill(darkColor);
        car.rect(8, 8).move(174, ROOF - 7).fill(darkColor);
        car.rect(8, 8).move(320, ROOF - 7).fill(darkColor);

        // Body: steep nose, shallow glass, raked tailgate.
        const ROOF_FRONT_X = 168, ROOF_REAR_X = 322;
        const body = car.path(
            `M${NOSE} ${SILL} L${NOSE} 250 L28 234 L100 ${BELT + 2} L150 170 ` +
            `L${ROOF_FRONT_X} ${ROOF} L${ROOF_REAR_X} ${ROOF} L340 170 ` +
            `L368 198 L380 214 L${TAIL} 232 L${TAIL} ${SILL} Z`)
            .fill(baseColor);

        // Glass, as one dark band with body-coloured pillars over it.
        car.polygon(`154,174 330,172 352,${BELT - 2} 122,${BELT - 2}`).fill(darkColor);
        car.rect(7, BELT - 176).move(212, 174).fill(baseColor);
        car.rect(7, BELT - 176).move(268, 174).fill(baseColor);
        const top = car.polygon(`326,172 350,${BELT - 2} 338,${BELT - 2} 316,174`).fill(baseColor);

        // Black lower cladding along the sill, and the low front bumper.
        car.rect(TAIL - NOSE, 14).move(NOSE, SILL - 14).fill(darkColor);
        // Angular headlight and the rear light bar.
        const leftLight = car.polygon("20,246 52,234 56,242 24,254").fill(config.colors.lightsOff);
        const rightLight = car.rect(16, 6).move(TAIL - 20, 228).radius(2).fill(config.colors.lightsOff);

        // Arches: cut the body, then the chunky black flares.
        const arch = (cx) =>
            `M${cx - FLARE_R} ${SILL - 2} L${cx - FLARE_R} ${AXLE_Y} ` +
            `A${FLARE_R} ${FLARE_R} 0 0 1 ${cx + FLARE_R} ${AXLE_Y} ` +
            `L${cx + FLARE_R} ${SILL - 2} L${cx + WHEEL_R + 1} ${SILL - 2} ` +
            `L${cx + WHEEL_R + 1} ${AXLE_Y} ` +
            `A${WHEEL_R + 1} ${WHEEL_R + 1} 0 0 0 ${cx - WHEEL_R - 1} ${AXLE_Y} ` +
            `L${cx - WHEEL_R - 1} ${SILL - 2} Z`;
        svg.circle((WHEEL_R + 1) * 2).center(FRONT_X, AXLE_Y).fill(bg);
        svg.circle((WHEEL_R + 2) * 2).center(REAR_X, AXLE_Y).fill(bg);
        svg.path(arch(FRONT_X)).fill(darkColor);
        svg.path(arch(REAR_X)).fill(darkColor);

        const leftWheel = svg.circle(WHEEL_R * 2).center(FRONT_X, AXLE_Y).fill(darkColor);
        const rightWheel = svg.circle(WHEEL_R * 2).center(REAR_X, AXLE_Y).fill(darkColor);
        svg.circle(WHEEL_R * 1.24).center(FRONT_X, AXLE_Y).fill(baseColor).opacity(0.85);
        svg.circle(WHEEL_R * 1.24).center(REAR_X, AXLE_Y).fill(baseColor).opacity(0.85);
        svg.circle(WHEEL_R * 0.5).center(FRONT_X, AXLE_Y).fill(darkColor);
        svg.circle(WHEEL_R * 0.5).center(REAR_X, AXLE_Y).fill(darkColor);

        // Battery, on the front door.
        const battery = svg.group().attr("id", "battery");
        const batteryBody = battery.rect(96, 30).move(132, 224).radius(5)
            .fill(baseColor).hide();
        const batteryTop = battery.rect(7, 14).move(228, 232).radius(2)
            .fill(baseColor).hide();
        const batteryLevel = batteryBody.clone().attr("id", "battery_level");
        const batteryPercent = svg.text("")
            .move(180, 225)
            .font({ size: 24, anchor: "middle", fill: config.colors.batteryPercent })
            .attr("id", "battery_percent");

        const charging = svg.path("M248 218 l-12 22 l10 0 l-6 18 l16 -24 l-10 0 l8 -16 z")
            .fill(config.colors.chargingSign).hide();

        // Readouts outside the body, where there is contrast.
        const distance = svg.text("")
            .move(NOSE, 322)
            .font({ size: 21, anchor: "start", fill: textColor })
            .attr("id", "distance");
        const range = svg.text("")
            .move(TAIL, 322)
            .font({ size: 21, anchor: "end", fill: textColor, weight: 600 })
            .attr("id", "range");
        const remainingChargingTime = svg.text("")
            .move(200, 346)
            .font({ size: 18, anchor: "middle", fill: textColor })
            .attr("id", "remaining_charging_time");
        const position = svg.text("")
            .move(200, 368)
            .font({ size: 24, anchor: "middle", fill: textColor })
            .attr("id", "position");
        const outsideTemp = svg.text("")
            .move(NOSE, 36)
            .font({ size: 22, anchor: "start", fill: textColor });
        const lastConnection = svg.text("MyToyota")
            .move(TAIL, 36)
            .font({ size: 18, anchor: "end", fill: textColor });

        // Padlock, above the roof rails.
        const lockGroup = svg.group().attr("id", "lock").hide();
        const lockBody = lockGroup.rect(28, 22).move(186, 104).radius(4).fill("#00dd50");
        const lockShackleLocked = lockGroup.path("M193 104 v-8 a7 7 0 0 1 14 0 v8")
            .fill("none").stroke({ width: 5, color: "#00dd50" });
        const lockShackleOpen = lockGroup.path("M193 104 v-8 a7 7 0 0 1 14 0")
            .fill("none").stroke({ width: 5, color: "#00dd50" }).hide();

        return {
            svg, body, top, leftLight, rightLight, leftWheel, rightWheel,
            cableConnected, cableDisConnected, chargerBox, wall, charging,
            distance, battery, batteryBody, batteryTop, batteryLevel,
            batteryPercent, range, remainingChargingTime, position,
            driver: this.noElement(), driverHead: this.noElement(),
            antenna: this.noElement(),
            lastConnection, outsideTemp,
            lockGroup, lockBody, lockShackleLocked, lockShackleOpen
        };
    },

    // Add an entry here to offer another drawing via config.image.
    carImages: {
        Default: function (config) { return this.drawDefault(config); },
        Touring: function (config) { return this.drawTouring(config); }
    },

    updateCar: function (drawing, carData, config) {
        // getDom draws on a timer, so the first data can arrive first.
        if (!drawing) return;
        // Distance covered
        if (config.showDistance && carData.has("distanceCovered")) {
            drawing.distance.text(carData.get("distanceCovered").value + " " + carData.get("distanceCovered").suffix).show();
        } else {
            drawing.distance.hide();
        }

        // Outside temperature
        if (carData.has("outsideTemp")) {
            const t = carData.get("outsideTemp");
            drawing.outsideTemp.text(t.value + t.suffix).show();
        } else {
            drawing.outsideTemp.hide();
        }

        // Padlock — only when parked
        const isNotDriving = !carData.has("driving") || carData.get("driving").value === "NO";
        if (carData.has("lockState") && isNotDriving) {
            const locked = carData.get("lockState").value === "LOCKED";
            const lockColor = locked ? "#00dd50" : "#dd2828";
            drawing.lockBody.fill(lockColor);
            drawing.lockShackleLocked.stroke({ width: 6, color: lockColor });
            drawing.lockShackleOpen.stroke({ width: 6, color: lockColor });
            if (locked) {
                drawing.lockShackleLocked.show();
                drawing.lockShackleOpen.hide();
            } else {
                drawing.lockShackleLocked.hide();
                drawing.lockShackleOpen.show();
            }
            drawing.lockGroup.show();
        } else {
            drawing.lockGroup.hide();
        }

        // Cable connection state
        const isConnected = carData.has("connectionState") && carData.get("connectionState").value === "CONNECTED";
        if (isNotDriving && carData.has("connectionState")) {
            if (isConnected) {
                drawing.cableConnected.show();
                drawing.cableDisConnected.hide();
                drawing.wall.show();
                drawing.chargerBox.show();
            } else {
                drawing.cableConnected.hide();
                drawing.cableDisConnected.show();
                drawing.wall.show();
                drawing.chargerBox.show();
            }
        } else if (!isNotDriving) {
            drawing.cableConnected.hide();
            drawing.cableDisConnected.hide();
            drawing.wall.hide();
            drawing.chargerBox.hide();
        } else {
            // driving=NO but no connectionState data → hide cable entirely, show wall
            drawing.cableConnected.hide();
            drawing.cableDisConnected.hide();
            drawing.wall.show();
            drawing.chargerBox.show();
        }

        // Charging
        if (carData.has("charging")) {
            if (carData.get("charging").value == "CHARGING") {
                drawing.charging.show();
                if (carData.has("chargingRemainingHour") && carData.has("chargingRemainingMinute")) {
                    drawing.remainingChargingTime.text(
                        ""
                        + carData.get("chargingRemainingHour").value
                        + carData.get("chargingRemainingHour").suffix
                        + " "
                        + carData.get("chargingRemainingMinute").value
                        + carData.get("chargingRemainingMinute").suffix
                    ).show();
                } else {
                    drawing.remainingChargingTime.hide();
                }
            } else {
                drawing.charging.hide();
                drawing.remainingChargingTime.hide();
            }
        }

        // Battery level
        if (carData.has("battery")) {
            const level = carData.get("battery").value;
            drawing.batteryBody.show();
            drawing.batteryTop.show();
            drawing.batteryLevel.width(drawing.batteryBody.width() * level / 100).show();

            let colors;
            for (let i = 0; i < config.batteryColors.length; i++) {
                colors = config.batteryColors[i];
                if (level < config.batteryColors[i].upTo) {
                    break;
                }
            }

            drawing.batteryLevel.fill(colors.forground);
            drawing.battery.fill(colors.background);

            if (config.showBatteryPercent) {
                drawing.batteryPercent.text("" + level + " " + carData.get("battery").suffix).fill(colors.text);
            }
            if (config.showRange && carData.has("range")) {
                drawing.range.text("" + carData.get("range").value + " " + carData.get("range").suffix);
            }
        }

        // Position
        if (config.showPosition) {
            if (carData.has("latitude")) {
                // Toyota does not report a driving flag at all, so absence of
                // one means parked — the same convention isNotDriving uses
                // above. Requiring an explicit "NO" made the car look like it
                // was permanently driving.
                const isDriving = carData.has("driving") && carData.get("driving").value == "YES";
                if (isDriving) {
                    drawing.position.text(this.translate("DRIVING"));
                } else {
                    drawing.position.text(this.findPosition(carData));
                }
            } else {
                // No GPS data available from EU Data Act portal
                drawing.position.hide();
            }
        }

        // Driving
        if (config.showDriving && carData.has("driving")) {
            if (carData.get("driving").value == "YES") {
                drawing.leftLight.fill(config.colors.lightsOn);
                drawing.rightLight.fill(config.colors.lightsOn);
                drawing.driver.show();
                drawing.driverHead.show();
                drawing.wall.hide();
                drawing.chargerBox.hide();
                drawing.cableConnected.hide();
                drawing.cableDisConnected.hide();
            } else {
                drawing.leftLight.fill(config.colors.lightsOff);
                drawing.rightLight.fill(config.colors.lightsOff);
                drawing.driver.hide();
                drawing.driverHead.hide();
            }
        }

        // Last connection / data freshness
        this.updateLastConnection(drawing, carData);
    },

    updateLastConnection: function (drawing, carData) {
        if (!drawing) return;
        if (carData instanceof Map && carData.has("apiConnection")) {
            if (carData.get("apiConnection").value == "OK") {
                if (carData.has("lastDatasetTime")) {
                    const timeStr = carData.get("lastDatasetTime").value;
                    const date = new Date(timeStr);
                    drawing.lastConnection.text(this.calculateAge(date));
                } else {
                    drawing.lastConnection.text("MyToyota");
                }
            } else if (carData.get("apiConnection").value == "NO INTERNET") {
                drawing.lastConnection.text("We have no internet");
            } else if (carData.get("apiConnection").value == "SETUP_REQUIRED") {
                drawing.lastConnection.text("Setup required – see log");
            } else {
                drawing.lastConnection.text("We don't connect");
            }
        } else {
            drawing.lastConnection.text("We don't connect");
        }
    }});
