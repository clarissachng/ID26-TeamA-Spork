#include <Wire.h>
#include <Adafruit_Sensor.h>
#include <Adafruit_HMC5883_U.h>

Adafruit_HMC5883_Unified mag1 = Adafruit_HMC5883_Unified(12345);

void setup(void) {
  Serial.begin(115200);
  if(!mag1.begin()) {
    while(1); // Sensor not found
  }
}

void loop(void) {
  sensors_event_t event1;
  mag1.getEvent(&event1);

  Serial.print("{\"x\":"); Serial.print(event1.magnetic.x);
  Serial.print(",\"y\":"); Serial.print(event1.magnetic.y);
  Serial.print(",\"z\":"); Serial.print(event1.magnetic.z);
  
  /* If you have a second magnet/sensor for squeezing, 
     calculate x2/y2 and add them to the JSON:
     Serial.print(",\"x2\":"); Serial.print(val2X);
     Serial.print(",\"y2\":"); Serial.print(val2Y);
  */
  
  Serial.println("}");
  delay(40); // 25Hz output
}