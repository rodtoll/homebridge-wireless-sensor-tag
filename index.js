var request = require("request");

const PLUGIN_NAME = "homebridge-wireless-sensor-tag";
const PLATFORM_NAME = "WirelessSensorTagV2";
const DEFAULT_UPDATE_FREQUENCY_MS = 60000;
const MANUFACTURER_NAME = "Cao Gadgets LLC";
const IDENTIFY_BEEP_DURATION = 5;
const MINIMUM_QUERY_FREQUENCY_MS = 20000;

var hap;
var Accessory;

module.exports = (api) => {
    hap = api.hap;
    Accessory = api.platformAccessory;
    api.registerPlatform(PLATFORM_NAME, WirelessSensorTagV2Platform);
}

class WirelessSensorTagV2Platform {

  constructor(log, config, api) {
    this.log = log;
    this.api = api;
    this.accessories = [];
    this.tagIdToAccessoryId = {};
    this.accessoryMap = {};
    this.userName = config.userName;
    this.password = config.password;
    this.ignoreNames = config.ignoreNames;
    this.accessoryIdToSid = {};
    if(config.queryFrequency == null || config.queryFrequency == undefined) {
      this.queryFrequency = DEFAULT_UPDATE_FREQUENCY_MS;
    } else {
      if(config.queryFrequency < MINIMUM_QUERY_FREQUENCY_MS) {
        this.log.error("You specified query frequency less than one second which will spam the server. Setting to minimum of 1s. Reminder, value is in MS, not seconds.")
        this.queryFrequency = DEFAULT_UPDATE_FREQUENCY_MS;
      } else {
        this.queryFrequency = config.queryFrequency;
      }
    }

    log.info("Initialization beginning.");

    api.on("didFinishLaunching", () => {
      this.executeAuthentication();
    });
  }

  configureAccessory(accessory) {
    this.log("Configuring accessory "+accessory.displayName+" aid: "+accessory.UUID);

    if(this.accessoryMap[accessory.UUID] != null) {
      this.log("Ignoring redundant configure accessory");
      return;
    }

    this.accessoryMap[accessory.UUID] = accessory;

    accessory.on("identify", () => {
        this.log("%s identified!", accessory.displayName);
        let sid = this.accessoryIdToSid[aid];
        if(sid != null) {
            this.makeApiCall('https://www.mytaglist.com/ethClient.asmx/Beep', 
            { id: sid, beepDuration: IDENTIFY_BEEP_DURATION },
            (body) => { 
              this.log.info("Sent beep command to the tag: "+sid);
            }, 
            (error) => { l
              log.error("Unable to send beep command to the tag: "+error); 
            });            
        }
    });

    this.accessories.push(accessory);
  }

  // --------------------------- CUSTOM METHODS ---------------------------

  makeApiCall(uri, requestBody, handleSuccess, handleError) {
    request({
      method: 'POST',
      uri: uri,
      json: true,
      jar: true,
      gzip: true,
      body: requestBody
    }, (error, response, body) => {
        if(error) {
          handleError(error);
        } else {
          handleSuccess(body);
        }
    });    
  }

  getTagList() {
    this.makeApiCall('https://www.mytaglist.com/ethClient.asmx/GetTagList2', 
      {},
      (body) => { 
        this.parseTagList(body) 
      }, 
      (error) => { l
        log.error("Error getting the tag list: "+error); 
      });
  }

  executeAuthentication() {
    this.makeApiCall('https://www.mytaglist.com/ethAccount.asmx/Signin',
      { email: this.userName, password: this.password },
      (body) => {
        this.log.info("Authenticated to server, querying for tag list");
        this.getTagList();         
        setInterval(() => { this.handleQueryTimer(); }, this.queryFrequency);        
      },
      (error) => { 
        log("ERROR: "+error); 
      });
  }

  handleQueryTimer() {
    this.log.info("Querying server for latest tag info");
    this.getTagList();
  }

  mapTID2AID(tagInfo) {
    if(this.tagIdToAccessoryId[tagInfo.uuid] == null) {
      this.tagIdToAccessoryId[tagInfo.uuid] = hap.uuid.generate(tagInfo.uuid)
    } 
    return this.tagIdToAccessoryId[tagInfo.uuid];
  }

  isTagNew(tagInfo) {
    const aid = this.mapTID2AID(tagInfo);
    return (this.accessoryMap[aid] == null);
  }

  isTagReadingHumidity(tagInfo) {
    return (tagInfo.cap != undefined);
  }

  shouldIgnore(tagInfo) {
    if(this.ignoreNames != null && this.ignoreNames != undefined) {
      for(let name of this.ignoreNames) {
        if(tagInfo.name.includes(name)) {
          return true;
        }
      }
    }
    return false;
  }

  parseTagList(body) {
    for(let tagInfo of body.d) {
      // We haven't seen the tag yet, add it
      if(this.isTagNew(tagInfo)) {
          this.addTag(tagInfo);
      // We have, just update it.
      } else {
          this.updateTag(tagInfo);
      }
    } 
  }  

  getTagBatteryLowCharacteristic(tagInfo) {
    if(tagInfo.batteryRemaining < 0.40) {
      return hap.Characteristic.StatusLowBattery.BATTERY_LEVEL_LOW;
    } else {
      return hap.Characteristic.StatusLowBattery.BATTERY_LEVEL_NORMAL;
    }
  }

  getTagModelName(tagInfo) {
    switch(tagInfo.tagType) {
      case 2: return "Basic";
      case 12: return "MotionSensor";
      case 13: return "MotionHTU";
      case 21: return "MotionHTUMem";
      case 22: return "Solar";
      case 26: return "LightHTUMem";
      case 32: return "Cap";
      case 33: return "CapThermister";
      case 52: return "Reed_HTU";
      case 53: return "Reed_noHTU";
      case 62: return "Thermostat";
      case 72: return "PIR";
      case 82: return "WeMo";
      case 92: return "WebCam";
      case 102: return "USB";      
      case 196: return "USB_ZMOD";      
      case 107: return "USB_ALS";      
      default: return "Unknown";
    }
  }

  addTag(tagInfo) {

    const aid = this.mapTID2AID(tagInfo);

    if(this.shouldIgnore(tagInfo)) {
      this.log.info("Ignoring tag: "+tagInfo.name+" "+tagInfo.uuid+" tid: "+" aid: "+aid);
      return;
    }

    this.log.info("Adding tag: "+tagInfo.name+" "+tagInfo.uuid+" tid: "+" aid: "+aid);

    const accessory = new Accessory(tagInfo.name, aid);

    accessory.addService(hap.Service.TemperatureSensor, tagInfo.name+" Temperature");

    // Only add humidity state if this tag supports it
    if(this.isTagReadingHumidity(tagInfo)) {
      this.log.info("Tag supports humidity");
      accessory.addService(hap.Service.HumiditySensor, tagInfo.name+" Humidity");
    }

    this.configureAccessory(accessory); // abusing the configureAccessory here

    let accessoryService = accessory.getService(hap.Service.AccessoryInformation);
    accessoryService.updateCharacteristic(hap.Characteristic.Manufacturer, MANUFACTURER_NAME);
    accessoryService.updateCharacteristic(hap.Characteristic.SerialNumber, tagInfo.uuid);
    accessoryService.updateCharacteristic(hap.Characteristic.Model, this.getTagModelName(tagInfo) );

    this.updateTag(tagInfo);

    this.api.registerPlatformAccessories(PLUGIN_NAME, PLATFORM_NAME, [accessory]);
  }

  getTagTempInF(tagInfo) {
    return (tagInfo.temperature*(9/5)+32);
  }

  updateTag(tagInfo) {
    const aid = this.mapTID2AID(tagInfo);

    if(this.shouldIgnore(tagInfo)) {
      this.log.info("Ignoring update for ignored tag: "+tagInfo.name+" "+tagInfo.uuid+" tid: "+" aid: "+aid);
      return;
    }
    this.log.info("Updating tag: "+tagInfo.name+" tid: "+tagInfo.uuid+" aid: "+aid);
    // Snag the tag id
    this.accessoryIdToSid[aid] = tagInfo.slaveId;
    let batteryLevel = this.getTagBatteryLowCharacteristic(tagInfo);
    let accessory = this.accessoryMap[aid];
    accessory.getService(hap.Service.TemperatureSensor).updateCharacteristic(hap.Characteristic.CurrentTemperature, this.getTagTempInF(tagInfo));
    accessory.getService(hap.Service.TemperatureSensor).updateCharacteristic(hap.Characteristic.StatusLowBattery, batteryLevel );
    if(this.isTagReadingHumidity(tagInfo)) {
      accessory.getService(hap.Service.HumiditySensor).updateCharacteristic(hap.Characteristic.CurrentRelativeHumidity, Math.round(tagInfo.cap));
      accessory.getService(hap.Service.HumiditySensor).updateCharacteristic(hap.Characteristic.StatusLowBattery, batteryLevel );
    }  
    let accessoryService = accessory.getService(hap.Service.AccessoryInformation);
    accessoryService.updateCharacteristic(hap.Characteristic.FirmwareRevision, String(tagInfo.rev));    
  }

  removeAccessories() {
    this.log.info("Removing all accessories");
    this.api.unregisterPlatformAccessories(PLUGIN_NAME, PLATFORM_NAME, this.accessories);
    this.accessories.splice(0, this.accessories.length); // clear out the array
  }
}
