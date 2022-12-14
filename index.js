const { debug } = require('console');

var Service, Characteristic;

module.exports = function (homebridge) {
  Service = homebridge.hap.Service;
  Characteristic = homebridge.hap.Characteristic;
  homebridge.registerAccessory("homebridge-enlighten-power", "enlighten-power", AirQualityAccessory);
}

function AirQualityAccessory(log, config) {

  // Don't load the plugin if these aren't accessible for any reason
  if (!log || !config) {
    return
  }

  this.log = log

  this.log("Initialising...")

  this.name = config["name"];
  this.connection = config["connection"] || "bonjour"; // local or api
  if (this.connection == "api") {
    this.api_key = config["api_key"];
    this.api_user_id = config["api_user_id"];
    this.site_id = config["site_id"];
    this.url = "https://api.enphaseenergy.com/api/v2/systems/" + this.site_id + "/summary?key=" + this.api_key + "&user_id=" + this.api_user_id;
    this.updateInterval = config['update_interval'] || "5"; // every 5 min
  }
  if (this.connection == "bonjour") {
    this.url = "http://envoy.local/production.json";
    this.updateInterval = config['update_interval'] || "1"; // every minutes
    // allow change production type and handling current default to 1 
    temp_type = config["type"] || "eim";
    this.type = (temp_type == "eim") ? 1 : 0;
  }
  if (this.connection == "url") {
    this.url = config["url"];
    this.updateInterval = config['update_interval'] || "1"; // every minutes
    // allow change production type and handling current default to 1 
    temp_type = config["type"] || "eim";
    this.type = (temp_type == "eim") ? 1 : 0;
  }
  this.co2Threshold = config['power_threshold'];
  this.co2CurrentLevel = 0;
  this.co2Detected = 0;
  this.co2LevelUpdated = false;

  this.service = new Service.CarbonDioxideSensor(this.name);

  this.service
    .getCharacteristic(Characteristic.CarbonDioxideLevel)
    .on('get', this.getCo2Level.bind(this));

  this.service
    .getCharacteristic(Characteristic.CarbonDioxideDetected)
    .on('get', this.getCo2Detected.bind(this));

  this.informationService = new Service.AccessoryInformation();

  this.informationService
    .setCharacteristic(Characteristic.Manufacturer, "Homebridge")
    .setCharacteristic(Characteristic.Model, "Enlighten")
    .setCharacteristic(Characteristic.SerialNumber, "0000030");

  setInterval(function () {
    this.getCo2Level(function (err, value) {
      if (err) {
        value = err;
      }
      this.service
        .getCharacteristic(Characteristic.CarbonDioxideLevel).updateValue(value);
    }.bind(this));
  }.bind(this), this.updateInterval * 60000);

  this.getCo2Level(function (err, value) {
    this.service
      .setCharacteristic(Characteristic.CarbonDioxideLevel, value);
  }.bind(this));
}

AirQualityAccessory.prototype.setCo2Level = function () {
  this.service
    .setCharacteristic(Characteristic.CarbonDioxideLevel, this.co2CurrentLevel);
}

AirQualityAccessory.prototype.getCo2Level = function (callback) {

  let url = new URL(this.url)
  this.log.debug(url)
  var protocol = (url.protocol == "http:") ? require('http') : require('https')

  const options = {
    hostname: url.hostname,
    port: url.port,
    path: url.pathname + url.search,
    method: 'GET'
  }

  var req = protocol.request(options, (resp) => {

    this.log.debug("GET response received (%s)", resp.statusCode)

    let data = ''
    // A chunk of data has been received.
    resp.on('data', (chunk) => {
      data += chunk
    })

    // The whole response has been received. Print out the result.
    resp.on('end', () => {

      if (resp.statusCode == 200) {
        try {
          JSON.parse(data)
        } catch (e) {
          this.log("Error: not JSON!");
          callback(null, 0)
          return
        }

        var json = JSON.parse(data);
        this.log.debug("JSON: %s", json)
        if (this.connection == "api") {
          this.co2CurrentLevel = Math.round(parseFloat(json.current_power));
        }
        else {
          let power = Math.round(parseFloat(json.net-consumption[this.type].wNow));
          this.co2CurrentLevel = (power >= 0) ? power : 0;
        }
        this.co2LevelUpdated = true;
        this.log('Enlighten (%s): Current Power = %s W', this.connection, this.co2CurrentLevel);
        this.setCo2Level();
        this.setCo2Detected();
        callback(null, this.co2CurrentLevel);

      } else {
        this.log("Error getting current power: %s : %s", resp.statusCode, resp.statusMessage)
        callback(null, 0)
      }

    })
  })

  req.on("error", (err) => {
    this.log("Error getting current power: %s - %s : %s", err.code, err.status, err.message)
    callback(null, 0)
  })

  req.end()

}

AirQualityAccessory.prototype.setCo2Detected = function () {
  if (this.co2CurrentLevel >= this.co2Threshold) {
    this.co2Detected = 1;
  }
  else {
    this.co2Detected = 0;
  }
  this.service
    .setCharacteristic(Characteristic.CarbonDioxideDetected, this.co2Detected);
}

AirQualityAccessory.prototype.getCo2Detected = function (callback) {
  this.log('Current Power =', this.co2CurrentLevel, 'W');
  callback(null, this.co2Detected);
}

AirQualityAccessory.prototype.getServices = function () {
  return [this.service, this.informationService];
}
