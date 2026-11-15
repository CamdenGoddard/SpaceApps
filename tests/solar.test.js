load('js/solar.js');
function assert(ok,msg){if(!ok)throw Error(msg);print('PASS '+msg);}
const equinox=Solar.position(new Date('2024-03-20T12:00:00Z'));
assert(Math.abs(equinox.lat)<.3 && Math.abs(equinox.lon)<3,'equinox solar coordinates');
assert(Solar.position(new Date('2024-06-20T20:51:00Z')).lat>23.3,'June solstice');
assert(Solar.position(new Date('2024-12-21T09:20:00Z')).lat< -23.3,'December solstice');
assert(Solar.altitude(equinox.lat,equinox.lon,new Date('2024-03-20T12:00:00Z'))>89,'subsolar point is daylight');
assert(Solar.altitude(-equinox.lat,equinox.lon+180,new Date('2024-03-20T12:00:00Z'))< -89,'antipode is night');
