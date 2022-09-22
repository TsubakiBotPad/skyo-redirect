/*
 * Author: @chasehult
 */

const express = require('express');
const parser = require('body-parser');
const http = require("http");
const https = require("https");
const mongoose = require('mongoose');
const mysql = require('mysql');
const fs = require('fs');

const app = express();
app.use(parser.json());
app.use(parser.urlencoded({extended: true})); 

process.env["NODE_TLS_REJECT_UNAUTHORIZED"] = 0;

// Set up MongoDB
mongoose.connect('mongodb://127.0.0.1/tsubaki', {useNewUrlParser: true});
mongoose.connection.on('error', console.error.bind(console, 'MongoDB connection error:'));

var ObjectId = mongoose.Schema.ObjectId
var DungeonLink = mongoose.model('dungeonLink', new mongoose.Schema({
  dungeonId: Number,
  skyozoraLink: String,
  timestamp: Date,
}));
var SubDungeonLink = mongoose.model('SubDungeonLink', new mongoose.Schema({
  subDungeonId: Number,
  skyozoraLink: String,
  timestamp: Date,
}));

// Connect to MySQL
var con = mysql.createConnection(require('./db_config.json'));

con.connect(function(err) {if (err) throw err;});

// Set up routes
app.use(express.static('public_html'));
app.get('/', (req, res) => {res.redirect('/index.html');});


// Skyo lookup
failedSearchURL = "https://github.com/TsubakiBotPad/pad-cogs/wiki/skyo-404";

app.get('/:sdid', function(req, res) {
  var sdid = parseInt(req.params.sdid);
  if (isNaN(sdid)) {
    res.end()
  } else if (sdid < 10000) {
    // Dungeon
    DungeonLink.findOne({dungeonId: sdid}).exec(async function (err, dLink) {
      link = dLink?dLink.skyozoraLink:await findDungeonLink(sdid);
      res.redirect(link || failedSearchURL);
    });
  } else {
    // Sub Dungeon
    SubDungeonLink.findOne({subDungeonId: sdid}).exec(async function (err, sdLink) {
      link = sdLink?sdLink.skyozoraLink:await findSubDungeonLink(sdid);
      res.redirect(link || failedSearchURL);
    });
  }
});


function getPossibilities(link, functions) {
  if (functions.length == 0) {return [link];}
  let f = functions[0];
  let rest = functions.slice(1)
  return getPossibilities(link, rest).concat(getPossibilities(f(link), rest));
}

formattingFunctions = [
  link => link.replace(/【.*】/, ''),
  link => link.replace(/ /, ''),
]


function findSubDungeonLink(sdid) {
  return new Promise((resolve, reject) => {
    /**
     * Always resolves into either a valid Skyozora link or null.
     */
    con.query(`SELECT dungeons.name_ja AS dgName, sub_dungeons.name_ja AS sdName
               FROM sub_dungeons 
                    JOIN dungeons ON sub_dungeons.dungeon_id = dungeons.dungeon_id
               WHERE sub_dungeon_id = ?`, [sdid || 0],
      function (err, rows) {
        if (err) throw err;
        if (rows.length == 0) return resolve(null);

        // Build the possible links (With and without conditions)
        var links = []
        getPossibilities(rows[0].dgName.replace('/', '／'), formattingFunctions).forEach(
          (d) => getPossibilities(rows[0].sdName.replace('/', '／'), formattingFunctions).forEach(
            (s) => links.push(`${d}/${s}`)))
        links = links.map(path => encodeURI("https://pad.skyozora.com/stage/"+path));

        // This can resolve the outer promise before checking every link.
        if ([...new Set(links)].length == 1) resolve(links[0]);
        links.map(async function (link) {
          var options = {
            host: "pad.skyozora.com",
            path: link.substring(24),
            method: "HEAD"
          }
          https.request(options, function(res) {
            if (res.statusCode == 200) {
              SubDungeonLink.create({
                subDungeonId: sdid, 
                skyozoraLink: link, 
                timestamp: Date.now(),
              });
              resolve(link);
            } else {
              links.splice(links.indexOf(link), 1);
              if (links.length == 1) resolve(links[0]);
              else if (links.length == 0) {
                SubDungeonLink.create({
                  subDungeonId: sdid, 
                  skyozoraLink: null, 
                  timestamp: Date.now(),
                });
              }
            }
          })
        });
      }
    );
  });
}

function findDungeonLink(dgid) {
  return new Promise((resolve, reject) => {
    /**
     * Always resolves into either a valid Skyozora link or null.
     */
    con.query(`SELECT dungeons.name_ja AS dgName
               FROM dungeons WHERE dungeon_id = ?`, [dgid || 0],
      function (err, rows) {
        if (err) throw err;
        if (rows.length == 0) return resolve(null);

        // Build the possible links (With and without conditions)
        var links = getPossibilities(rows[0].dgName.replace('/', '／'), formattingFunctions)
                    .map(path => encodeURI("https://pad.skyozora.com/stage/"+path));
        // This can resolve the outer promise before checking every link.
        if ([...new Set(links)].length == 1) resolve(links[0]);
        links.map(async function (link) {
          var options = {
            host: "pad.skyozora.com",
            path: link.substring(24),
            method: "HEAD"
          }
          https.request(options, function(res) {
            if (res.statusCode == 200) {
              DungeonLink.create({
                dungeonId: dgid, 
                skyozoraLink: link, 
                timestamp: Date.now(),
              });
              resolve(link);
            } else {
              links.splice(links.indexOf(link), 1);
              if (links.length == 1) resolve(links[0]);
              else if (links.length == 0) {
                DungeonLink.create({
                  dungeonId: dgid, 
                  skyozoraLink: null, 
                  timestamp: Date.now(),
                });
              }
            }
          })
        });
      }
    );
  });
}

// Start Server
http.createServer(app).listen(80, () => console.log(`HTTP listening at port 80`));

// https.globalAgent.options.ca = require('ssl-root-cas').create();
// certs = require('./certs.json');
// https.createServer({
//   key: fs.readFileSync(certs['key']),
//   cert: fs.readFileSync(certs['cert'])
// }, app).listen(443, () => console.log(`HTTPS listening at port 443`));
