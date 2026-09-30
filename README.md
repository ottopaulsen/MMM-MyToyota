# MMM-MyToyota

Show data from your Toyota on [MagicMirror²](https://github.com/MagicMirrorOrg/MagicMirror),
using Toyota Connected Services Europe — the same service the MyToyota phone
app uses.

It draws the same car graphic as [MMM-WeConnect](https://github.com/ottopaulsen/MMM-WeConnect),
so battery, range, charging, lock state, odometer and position are shown the
same way.

## Installation

Go to `MagicMirror/modules` and write

    git clone <this repo>

There is nothing to install: the module has no npm dependencies. `svg.js`
(MIT) is vendored in `vendor/`.

## Configuration

    {
      module: "MMM-MyToyota",
      position: "top_right",
      config: {
        username: "you@example.com",
        password: "your-mytoyota-password"
      }
    },

### Configuration options

| Option                   | Default | Description                                                                                          |
| ------------------------ | ------- | ---------------------------------------------------------------------------------------------------- |
| `username`               | –       | Your MyToyota account name, the same one the phone app uses. Required.                                 |
| `password`               | –       | Your MyToyota password. Required. Keep it out of git — see below.                                      |
| `vin`                    | –       | Only needed when the account has more than one car. Otherwise the first vehicle is used.               |
| `refreshIntervalSeconds` | `900`   | How often to poll. Toyota refreshes roughly every 15 minutes, so polling harder gains nothing.         |
| `size`                   | `300`   | Width of the drawing in pixels.                                                                        |
| `image`                  | `Default` | Which car drawing to use: `Default` (front view, as MMM-WeConnect) or `Touring` (bZ4X Touring from the side). |
| `showDistance`           | `true`  | Show the odometer reading.                                                                             |
| `showPosition`           | `true`  | Look up the car's position and show the name of a known place from `positions`. Set `false` to skip the location call entirely. |
| `showBattery`            | `true`  | Draw the battery.                                                                                      |
| `showBatteryPercent`     | `true`  | Show the charge level as a number.                                                                     |
| `showRange`              | `true`  | Show the remaining range.                                                                              |
| `showConnectionStatus`   | `true`  | Show the charging cable and wall box.                                                                  |
| `showDriving`            | `true`  | Show wheels turning while the car is moving.                                                           |
| `logging`                | `false` | Log the raw API responses. Useful when a value does not show up.                                       |
| `colors`                 | see source | Colours of the car, text and charging sign.                                                         |
| `batteryColors`          | see source | Colour thresholds for the battery indicator.                                                        |
| `positions`              | see source | Named places with `lat`, `lon` and `marginMeters`, used to say *where* the car is rather than showing coordinates. |
| `homePosition`           | `Hjemme` | Which of `positions` counts as home.                                                                  |

### Keeping the password out of git

MagicMirror substitutes `${VAR}` in `config.js` from `config/config.env`, so
the password need not be written into the config itself:

    // config.env
    TOYOTA_PASSWORD=...

    // config.js
    password: "${TOYOTA_PASSWORD}",

Do not name it `SECRET_*` unless you also want it hidden from the front-end;
this value is only used in the node helper, so either name works.

## What is shown

Which values appear depends on the model. A battery electric car reports
charge level, range and charging state; a hybrid reports fuel level and fuel
range instead. Anything the car does not report is simply left out of the
drawing rather than shown as blank.

## Adding another car drawing

Each drawing is a function returning the same set of named SVG elements, which
`updateCar` then shows, hides and fills. Because every drawing owns its own
layout, the readouts can sit wherever suits that shape — the positions in
`drawTouring` have nothing to do with those in `drawDefault`.

To add one:

1. Write `drawMyCar: function (config) { ... }` next to the others. Build it in
   the 400x400 viewbox and return the same keys as `drawDefault`. Use
   `this.noElement()` for anything your drawing does not have — a side view has
   no driver figure, for instance — and `updateCar` will then call into a
   harmless stub rather than throwing.
2. Register it: `carImages: { ..., MyCar: function (c) { return this.drawMyCar(c); } }`
3. Select it with `image: "MyCar"`.

An unknown name logs a warning and falls back to `Default`.

## CSS

Override anything in `MMM-MyToyota.css`. The outer element has class
`MMM-MyToyota`.

## Credits

The Toyota protocol — the ForgeRock login dance and the API headers — is a
port of [pytoyoda](https://github.com/pytoyoda/pytoyoda) (MIT), the library
behind the [Home Assistant Toyota integration](https://github.com/pytoyoda/ha_toyota).
Toyota does not document this API, so it can change without warning.

The car drawing comes from MMM-WeConnect by Otto Paulsen.
