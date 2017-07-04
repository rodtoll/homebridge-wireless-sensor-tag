# homebridge-wireless-sensor-tag
# ACTIVE DEVELOPMENT & SUPPORT DISCONTINUED
I am sad to announce that I am discontinuing support for this homebridge plugin. This means I will no longer be addressing any open bugs, responding to feature requests or 
releasing new versions. Between work and my home life there simply isn't the time. I will leave the repository online and the 
package on npm but that is it. As this code is licensed under the MIT license you are of course welcome to branch this code and make it your own and use it in your 
own projects -- but you do so, as always, with no warranty or support from me. 

I want to thank everyone who helped along the way through questions and issues and code contributions -- your assistance was very much appreciated. And it made the 
late nights and testing worth it. 

# Old Readme..

If you find a good alternative and want others to know about it then open a new issue and provide a pointer. I might post a link here.
 
Homebridge platform for Wireless Sensor Tags. (http://wirelesstags.net/)

Polls status of the wireless tags on a configurable interval and based on data from the tags determines occupancy of those tags + current temperature in 
degress celcius. 

Occupancy is 0 if the tag is inactive or out of range. Otherwise it is considered occupancy 1.

NOTE: Currently only supports the temperature tags. If someone wants to donate one of the other tag types happy to add them. :)
 
# Installation

1. Install homebridge using: npm install -g homebridge
2. Install this plugin using: npm install -g homebridge-wireless-sensor-tag
3. Update your configuration file. See sampleconfig.json in this repository for a sample. 
 
# Configuration

Configuration sample:
 
 ```
    "platforms": [
        {
            "platform": "wireless-sensor-tag",
            "name": "wireless-sensor-tag",         
            "username": "user@domain.com",      
            "password": "password",   
            "queryFrequency": 20000,
            "ignoreList": [ "Honda" ]
        }
    ] 
```
     
 Fields:
 * platform - Must be set to wireless-sensor-tag
 * name - Up to you. 
 * username - Your wirelesstags.net username
 * password - Your wirelesstags.net password
 * queryFrequency - The amount of time, in ms, between updates. 1000 = 1000ms = 1second. Recommended value > 10000 as temperature and presence don't change that quickly anyhow.
 * ignoreList - The list of names of tags that should be ignored. If a tag's name is an exact match to one of the strings in this array it is ignored by this plugin.

