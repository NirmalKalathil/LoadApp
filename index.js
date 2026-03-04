var express = require("express");
var app = express();
var bodyparser = require("body-parser");

app.use(bodyparser.urlencoded({ extended: true }));
var home = require("./home");
app.set("view engine", "ejs");
app.set("views", "./views");

// app.listen("3000", () => {
//   console.log("Server Started");
// });
app.use("/", home);

