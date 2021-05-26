var request = require("request");

// Plug in name
const PLUGIN_NAME = "homebridge-wireless-sensor-tag";

// Name for the platform
const PLATFORM_NAME = "wireless-sensor-tag";

// Default update frequency
const DEFAULT_UPDATE_FREQUENCY_MS = 20000;

// Manufacturer name for accessory properties
const MANUFACTURER_NAME = "Cao Gadgets LLC";

// Duration that tag should beep when identify is triggered
const IDENTIFY_BEEP_DURATION = 5;

// Minimum frequency for query
const MINIMUM_QUERY_FREQUENCY_MS = 20000;

// Suffix to add for temperature sensors
const SENSOR_SUFFIX_TEMPERATURE = " Temperature";

// Suffix to add for humidity sensors
const SENSOR_SUFFIX_HUMIDITY = " Humidity";

var hap;
var Accessory;

// Import all the platfomr pieces we need and register our platform 
module.exports = (api) => {
    hap = api.hap;
    Accessory = api.platformAccessory;
    api.registerPlatform(PLATFORM_NAME, WirelessSensorTagV2Platform);
}

// WirelessSensorTagV2Platform
//
// HomeBridge platform for supporting wireless tags from https://wirelesstag.net/.
//
// Supports only temperature tags.
// 
class WirelessSensorTagV2Platform {

  constructor(log, config, api) {
    this.log = log;
    this.api = api;
    this.accessories = [];

    // Map from the tag uuid to the accessory id
    this.tagIdToAccessoryId = {};

    // Map accessory from the accessory UUID to the accessory object
    this.accessoryMap = {};

    // Map accessory id to the internal id for the tag
    this.accessoryIdToSid = {};
    
    // Read configuration values
    this.userName = config.userName;
    this.password = config.password;
    this.ignoreNames = config.ignoreNames;

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

    // Platform plugin finished running, start authentication
    api.on("didFinishLaunching", () => {
      this.executeAuthentication();
    });
  }

  executeIdentify(displayName, sid) {
    this.log("%s identified!", displayName);
    this.makeApiCall('https://www.mytaglist.com/ethClient.asmx/Beep', 
      { id: sid, beepDuration: IDENTIFY_BEEP_DURATION },
    (body) => { 
      this.log.info("Sent beep command to the tag: "+displayName+" sid: "+sid);
    }, 
    (error) => { l
      log.error("Unable to send beep command to the tag: "+displayName+" sid: "+sid+" error: "+error); 
    }); 
  }

  // Homebridge platform called when is used to rehydrate previously cached devices.
  configureAccessory(accessory) {
    this.log("Configuring accessory "+accessory.displayName+" aid: "+accessory.UUID);

    // Ensure we do not configure the accessory twice
    if(this.accessoryMap[accessory.UUID] != null) {
      this.log("Ignoring redundant configure accessory");
      return;
    }
    this.accessoryMap[accessory.UUID] = accessory;

    let sid = this.accessoryIdToSid[accessory.UUID];
    let displayName = accessory.displayName;

    // Handle 
    accessory.on("identify", () => {
        this.executeIdentify(displayName, sid);
    });

    this.accessories.push(accessory);
  }

  // Not platform functions

  // Function to make platform POST call with the right parameters
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

  // Helper function that retrieves the tag list and adds any new tags and updates existing tags
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

  // Executes authentication. Auth is stored in a cookie
  // Also starts the interval timer which will periodically
  // call handleQueryTimer.
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

  // Called whenever we need to update the tags
  handleQueryTimer() {
    this.log.info("Querying server for latest tag info");
    this.getTagList();
  }

  // Maps the tag id to the aid
  mapTID2AID(tagInfo) {
    if(this.tagIdToAccessoryId[tagInfo.uuid] == null) {
      this.tagIdToAccessoryId[tagInfo.uuid] = hap.uuid.generate(tagInfo.uuid)
    } 
    return this.tagIdToAccessoryId[tagInfo.uuid];
  }

  // Is this tag new?
  isTagNew(tagInfo) {
    const aid = this.mapTID2AID(tagInfo);
    return (this.accessoryMap[aid] == null);
  }

  // Checks to see if the tag supports humidity
  isTagReadingHumidity(tagInfo) {
    return (tagInfo.cap != undefined);
  }

  // Checks a tag to see if it should be ignored based on the config.
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

  // Parses the tag query results using it to add or 
  // update existing tags. 
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

  // Maps tag info battery info to the right characteristic value
  getTagBatteryLowCharacteristic(tagInfo) {
    if(tagInfo.batteryRemaining < 0.40) {
      return hap.Characteristic.StatusLowBattery.BATTERY_LEVEL_LOW;
    } else {
      return hap.Characteristic.StatusLowBattery.BATTERY_LEVEL_NORMAL;
    }
  }

  // Gets the friendly name of the tag model from the taginfo structure
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

  // Adds a new tag to the platform based on the tag info
  addTag(tagInfo) {
    const aid = this.mapTID2AID(tagInfo);

    if(this.shouldIgnore(tagInfo)) {
      this.log.info("Ignoring tag: "+tagInfo.name+" "+tagInfo.uuid+" tid: "+" aid: "+aid);
      return;
    }

    this.log.info("Adding tag: "+tagInfo.name+" "+tagInfo.uuid+" tid: "+" aid: "+aid);

    const accessory = new Accessory(tagInfo.name, aid);

    // Setup the temp sensor service
    accessory.addService(hap.Service.TemperatureSensor, tagInfo.name+SENSOR_SUFFIX_TEMPERATURE);

    // Only add humidity state if this tag supports it
    if(this.isTagReadingHumidity(tagInfo)) {
      this.log.info("Tag supports humidity");
      accessory.addService(hap.Service.HumiditySensor, tagInfo.name+SENSOR_SUFFIX_HUMIDITY);
    }

    this.configureAccessory(accessory); // abusing the configureAccessory here

    // Setup fixed accessory information
    let accessoryService = accessory.getService(hap.Service.AccessoryInformation);
    accessoryService.updateCharacteristic(hap.Characteristic.Manufacturer, MANUFACTURER_NAME);
    accessoryService.updateCharacteristic(hap.Characteristic.SerialNumber, tagInfo.uuid);
    accessoryService.updateCharacteristic(hap.Characteristic.Model, this.getTagModelName(tagInfo) );

    this.updateTag(tagInfo);

    this.api.registerPlatformAccessories(PLUGIN_NAME, PLATFORM_NAME, [accessory]);
  }

  // Converts tag temperature to F from celcius
  getTagTempInF(tagInfo) {
    return (tagInfo.temperature*(9/5)+32);
  }

  getTagTempInC(tagInfo) {
    return tagInfo.temperature;
  }

  // Updates the state of the tag based on the update
  updateTag(tagInfo) {
    const aid = this.mapTID2AID(tagInfo);

    if(this.shouldIgnore(tagInfo)) {
      this.log.info("Ignoring update for ignored tag: "+tagInfo.name+" "+tagInfo.uuid+" tid: "+" aid: "+aid);
      return;
    }
    this.log.info("Updating tag: "+tagInfo.name+" tid: "+tagInfo.uuid+" aid: "+aid);
    this.accessoryIdToSid[aid] = tagInfo.slaveId;

    let batteryLevel = this.getTagBatteryLowCharacteristic(tagInfo);
    let accessory = this.accessoryMap[aid];

    accessory.getService(hap.Service.TemperatureSensor).updateCharacteristic(hap.Characteristic.CurrentTemperature, this.getTagTempInC(tagInfo));
    accessory.getService(hap.Service.TemperatureSensor).updateCharacteristic(hap.Characteristic.StatusLowBattery, batteryLevel );
    if(this.isTagReadingHumidity(tagInfo)) {
      accessory.getService(hap.Service.HumiditySensor).updateCharacteristic(hap.Characteristic.CurrentRelativeHumidity, Math.round(tagInfo.cap));
      accessory.getService(hap.Service.HumiditySensor).updateCharacteristic(hap.Characteristic.StatusLowBattery, batteryLevel );
    }  
    let accessoryService = accessory.getService(hap.Service.AccessoryInformation);
    accessoryService.updateCharacteristic(hap.Characteristic.FirmwareRevision, String(tagInfo.rev));    
  }

  // Removes all the accessories
  removeAccessories() {
    this.log.info("Removing all accessories");
    this.api.unregisterPlatformAccessories(PLUGIN_NAME, PLATFORM_NAME, this.accessories);
    this.accessories.splice(0, this.accessories.length); // clear out the array
  }
}
