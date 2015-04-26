// bind to public interface
require('./hello-world.js')({server: "ws://" + window.location.hostname + ":8080/"})