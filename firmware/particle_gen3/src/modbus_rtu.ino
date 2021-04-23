/*
 * Project WekaHR
 * Description:  Sync modbus device registers with Google Sheets
 * Copyright (c) Hudson Sonoma LLC
 * License : MIT
 */

// This #include statement was automatically added by the Particle IDE.
#include "ModbusSlave.h"
#include <JsonParserGeneratorRK.h>
#include "print_json.h"

SYSTEM_THREAD(ENABLED);

SerialLogHandler logHandler;


/* slave id = 10, control-pin = D6, baud = 9600
 */
#define SLAVE_ID 10
#define CTRL_PIN D6
#define BAUDRATE 19200

#define PIN_MODE_INPUT 0
#define PIN_MODE_OUTPUT 1

/**
 *  Modbus object declaration.
 */
// TX and RX pins are Serial1
Modbus slave(Serial1,SLAVE_ID, CTRL_PIN);

JsonParserStatic<2048, 100> jsonParser;

// Watchdog
ApplicationWatchdog wd( 24 * 60 * 60 * 1000, System.reset);  // 60*1000 is 60 seconds.

#define HOLDING_REGISTERS_LENGTH 80
uint16_t HoldingRegisters[HOLDING_REGISTERS_LENGTH];

// timer MAIN LOOP
unsigned long previousMillis = 0;
static unsigned long TIMER = 2000;

// timer publish - quell publishes that are less than 1 second apart
unsigned long previousPublishMillis = 0;

//uint16_t slaveID = 10;
//String eventName = "modbus";

String configName = "WekaHR/settings";

class Weka_config {
public:
    int _magic_number;
    uint16_t _unitID;
    char _event_name[255];

    Weka_config(): _magic_number(12345), _unitID(10), _event_name("modbus") {}
    bool read_eeprom() {
        Weka_config a;
        EEPROM.get(1024, a);
        Log.info("eeprom: reading %d",a._magic_number);
        if (a._magic_number == _magic_number) {
            Log.info("eeprom: valid");
            _unitID = a._unitID;
            strncpy( _event_name, a._event_name, sizeof(_event_name) );
            return true;
        }
        Log.info("eeprom: invalid magic number");
        return false;
    }
    void save_eeprom() {
        EEPROM.put(1024, *this);
        Log.info("EEPROM write %s",_event_name);
    }
};

Weka_config wekaConfig;



void setup() {
  
   
    // RS485 control pin must be output
    pinMode(CTRL_PIN, OUTPUT);
    digitalWrite(OUTPUT, LOW);

    delay(1000);
    
    /* register handler functions.
     * into the modbus slave callback vector.
     */
    //slave.cbVector[CB_READ_COILS] = readDigital;
    //slave.cbVector[CB_READ_DISCRETE_INPUTS] = readDigital;
    //slave.cbVector[CB_WRITE_COILS] = writeDigitalOut;
    slave.cbVector[CB_READ_INPUT_REGISTERS] = ModbusReadHR;
    slave.cbVector[CB_READ_HOLDING_REGISTERS] = ModbusReadHR;
    slave.cbVector[CB_WRITE_HOLDING_REGISTERS] = ModbusWriteHR;

    // LOAD CONFIG STATE FROM EERPOM
    wekaConfig.read_eeprom();
    //slaveID = wekaConfig._unitID;
    //eventName = wekaConfig._event_name;

    // LOAD initial INPUT_REGISTER state from saved json.
    String saved_data = getEEPROMstring();
    Log.info("getEEPROMstring: %s", saved_data.c_str());
    JsonWriteHR("/", saved_data.c_str(), false);  // Call and do not save back to EEPROM.

    // be ready to accept new JSON responses
    // WEBHOOK: Must set Response Topic to be {{{PARTICLE_DEVICE_ID}}}/hook-response/{{{PARTICLE_EVENT_NAME}}}
    // What if multiple webhooks are configured and they all send back new config data? - Last setting is used.
    String event_name = System.deviceID() + String("/hook-response/") + String(wekaConfig._event_name);
    Particle.subscribe(event_name.c_str(), JsonWriteHRSubscribe, MY_DEVICES);
    Log.info("Particle.subscribe %s", event_name.c_str());

    // Particle Functions
    Particle.function("ManualUpdate",SyncNow);

    Particle.function("PublishUnitID",PublishUnitID);
    Particle.function("SetUnitID",WriteUnitID);

    Particle.function("PublishEventName",PublishEventName);
    Particle.function("SetEventName",WriteEventName);

    Particle.function("PublishSettingsJSON",PublishEEPROM_JSON);
    Particle.function("SetSettingsJSON",WriteEEPROM_JSON);

    // set Serial and slave at baud 9600. / 19200
    Serial1.begin(BAUDRATE,SERIAL_8N1);   //SERIAL_8N1
    //Serial.begin( BAUDRATE );
    slave.begin( BAUDRATE );
    slave.unitID = wekaConfig._unitID;

}

void WekaPublish(const char * event_name, String data) {
    Log.info(data);
    if (Particle.connected()) {
         Particle.publish(event_name, data, PRIVATE);
    } else {
        Log.info("NOT CONNECTED, DISCARDING");
    }
}

int PublishUnitID(String command) {
    String data = String::format("{\"unit_id\":%d}", slave.unitID);
    WekaPublish(configName.c_str(), data);
    return 1;
}
int WriteUnitID(String idString) {

    long id = idString.toInt();

    if ( id >= 1 && id <= 247 ) {
        wekaConfig._unitID = (uint16_t) id;
        slave.unitID = (uint16_t) id;
        wekaConfig.save_eeprom();

        PublishUnitID(idString);
        return 1;
    } else {
        return 0;
    }

}
int PublishEventName(String command) {
    String data = String::format("{\"event_name\":\"%s\"}", wekaConfig._event_name);
    WekaPublish(configName.c_str(), data);
    return 1;
}
int WriteEventName(String event_name) {

    if (event_name.length() < 255 && event_name.length() > 2 ) {
        strncpy ( wekaConfig._event_name, event_name.c_str(), event_name.length() );
        wekaConfig._event_name[event_name.length()] = 0;  // NULL terminate always

        Log.info("event_name: %s",wekaConfig._event_name);
        wekaConfig.save_eeprom();
        PublishEventName(event_name);
        return 1;
    } else {
        return 0;
    }

}





void loop() {
    /* listen for modbus commands con serial port.
     *
     * on a request, handle the request.
     * if the request has a user handler function registered in cbVector.
     * call the user handler function.
     */ 
    slave.poll();
    
    delay(100);   // a 10 0 0 0 1 2 0 65 15 4b a 10

    unsigned long currentMillis = millis();
    if(currentMillis - previousMillis > TIMER) {
        previousMillis = currentMillis;

        //Log.info("%s", "looped");
    }

}


/**
 * Handel Read Holding Registers 
 * write back the values from the Holding Registers.
 */
uint8_t ModbusReadHR(uint8_t fc, uint16_t address, uint16_t length) {
    // read analog input
    for (int i = 0; i < length; i++) {
        // write uint16_t value to the response buffer.
        if (address + i >= HOLDING_REGISTERS_LENGTH ) { return STATUS_ILLEGAL_DATA_ADDRESS; }
        slave.writeRegisterToBuffer(i, HoldingRegisters[address + i]);
    }
    
    //String data = String::format(
    //                "{ \"function\": \"%s\", \"fc\": %d, \"address\": %d, \"length\": %d }",
    //                "ModbusReadHR",fc,address,length);
    //Particle.publish("modbus", data, PRIVATE);
    
    Log.info("ModbusReadHR");

    return STATUS_OK;
}

/**
 * Handle Force Single Coil (FC=05) and Force Multiple Coils (FC=15)
 * set digital output pins (coils).
 */
uint8_t ModbusWriteHR(uint8_t fc, uint16_t address, uint16_t length) {

    // Copy data into HR
    for(int i=address;i<(address+length);i++) {
        if (i >= HOLDING_REGISTERS_LENGTH ) { return STATUS_ILLEGAL_DATA_ADDRESS; }
        HoldingRegisters[address + i] = slave.readRegisterFromBuffer(i);
    }

    return JsonReadHR("writeLog");
}

// Publish to JSON HR.  Max 622 characters. (or 565)
uint8_t JsonReadHR(const char *functionName) {

    String cols = "";
    for(int i=0;i<HOLDING_REGISTERS_LENGTH;i++) {
        cols += String::format("%d,",HoldingRegisters[i]);
    }    
    cols.remove(cols.length()-1); // remove last ", "
 

    // this means the first publish gets through.  SHould change this so the last publish, (after one second of quiet) gets through
    unsigned long currentMillis = millis();
    if(currentMillis - previousPublishMillis > 1000) {
        previousPublishMillis = currentMillis;

        String data = String::format(
                        "{\"v\":\"1.0\",\"func\":\"%s\",\"addr\":%d,\"HR\":[%s]}",
                        functionName,0,cols.c_str());
        WekaPublish(wekaConfig._event_name, data);

    } else {

        String data = String::format(
                        "{\"v\":\"1.0\",\"func\":\"%s\",\"addr\":%d,\"HR\":[%s]}",
                        functionName,0,cols.c_str());
        //Particle.publish("modbus", data, PRIVATE);

        Log.info("QUELLED - NOT PUBLISHED %s", functionName);
        Log.info("%s", data.c_str());

    }




    return STATUS_OK;

}

void JsonWriteHRSubscribe(const char *event, const char *data) {
    JsonWriteHR(event, data, true); // call and save to eeprom if needed

    wd.checkin(); // checkin on internet response.  If no response in 24hr, reboot.
}


// Subscribed JSON into HR
void JsonWriteHR(const char *event, const char *data, bool save2eeprom) {
    int responseIndex = 0;

    Log.info("%s", "JsonWriteHoldingRegisters");

    const char *slashOffset = strrchr(event, '/');
    if (slashOffset) {
        responseIndex = atoi(slashOffset + 1);
    }

    if (responseIndex == 0) {
        jsonParser.clear();
    }
    jsonParser.addString(data);

    if (jsonParser.parse()) {
        // Looks valid (we received all parts)

        // This printing thing is just for testing purposes, you should use the commands to
        // process data
        printJson(jsonParser);

        // SAVE TO ARRAY.
        // ASSUME JSON OBJECT OF THE FORMAT: {"0":1,"1":0,"2":3,"3":4,"4":5,"5":0,"6":0,"7":0,"8":0,"9":0,"10":0,"11":0,"12":0,"13":0,"14":0,"15":0,"16":0,"17":0,"18":0,"19":0,"20":0,"21":0,"22":0,"23":0,"24":0,"25":0,"26":0,"27":0,"28":0,"29":0,"30":0,"31":0,"32":0,"33":0,"34":0,"35":0,"36":0,"37":0,"38":0,"39":39}
        // where key < INPUT_REGISTERS_LENGTH.  Only registers named "0"-"39" are saved. others are ignored.
        char buf[3];
        bool registers_changed = false;
        for (int i = 0; i < HOLDING_REGISTERS_LENGTH; i++) {
            snprintf(buf,3,"%d",i);
            int intValue;
            if (jsonParser.getOuterValueByKey(buf, intValue)) {
                if (HoldingRegisters[i] != (uint16_t) intValue) {
                    HoldingRegisters[i] = (uint16_t) intValue;
                    Log.info("reg changed: %d", i );
                    registers_changed = true;
                }
            }

        }

        if (registers_changed) {
            if (save2eeprom) {
                Log.info("SAVE SETTINGS: %s", data);
                putEEPROMstring(data);
            }
        }   

    }
}



int SyncNow(String command) {

    return (int)JsonReadHR("SyncNow");

}

int PublishEEPROM_JSON(String command) {

    String saved_data;
    saved_data = getEEPROMstring();

    jsonParser.clear();
    jsonParser.addString(saved_data.c_str());
    if (jsonParser.parse()) {
        String ss = String::format("{\"eeprom\":%s}", saved_data.c_str() );
        WekaPublish(configName, ss);
    } else {
        String ss = String::format("{\"eeprom\": { } }");
        WekaPublish(configName, ss );
    }

    return 0;

}

int WriteEEPROM_JSON(String json) {

    jsonParser.clear();
    jsonParser.addString(json.c_str());
    if (jsonParser.parse()) {
        JsonWriteHR("/", json.c_str(), true);
        return 1;
    } else {
        return 0;
    }

}
 
// max 4096 chars
int putEEPROMstring(const char * data) {

    char buf[1024];
    if ( strlen(data) > 1024-1 ) { return -1; }
    strncpy ( buf, data, 1024 );
    buf[1024-1] = 0;  // NULL terminate always

    EEPROM.put(0, buf);

    return 0;

}

String getEEPROMstring() {

    char buf[1024];
    EEPROM.get(0,buf);
    return String(buf);

}
