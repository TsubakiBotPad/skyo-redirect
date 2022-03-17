/*
 * Author: @chasehult
 */

const express = require('express');
const parser = require('body-parser');
const https = require("https");
const mongoose = require('mongoose');
const mysql = require('mysql');

const app = express();
app.use(parser.json());
app.use(parser.urlencoded({extended: true})); 

const port = 8081;

// Set up MongoDB
mongoose.connect('mongodb://127.0.0.1/tsubaki', {useNewUrlParser: true});
mongoose.connection.on('error', console.error.bind(console, 'MongoDB connection error:'));

var ObjectId = mongoose.Schema.ObjectId
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

app.get('/skyo/:subDungeonId', function(req, res) {
  var sdid = parseInt(req.params.subDungeonId);
  SubDungeonLink.findOne({subDungeonId: sdid}).exec(async function (err, sdLink) {
    link = sdLink?sdLink.skyozoraLink:await findLink(sdid);
    res.redirect(link || failedSearchURL);
  });
});

function findLink(sdid) {
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
        var cleanDgName = rows[0].dgName.replace('/', '／');
        var cleanSdName = rows[0].sdName.replace('/', '／');
        var cleanerDgName = cleanDgName.replace(/【.*】/, '');
        var cleanerSdName = cleanSdName.replace(/【.*】/, '');
        var links = [
          `${cleanDgName}/${cleanSdName}`,
          `${cleanDgName}/${cleanerSdName}`,
          `${cleanerDgName}/${cleanSdName}`,
          `${cleanerDgName}/${cleanerSdName}`,
        ].map(path => encodeURI("https://pad.skyozora.com/stage/"+path));

        // This can resolve the promise before checking every link.
        if ([...Set(links)].length == 1) resolve(links[0]);
        function validateLink(link) {
          return new Promise((res, rej) => {
            https.get(link, function(res) {
              if (res.statusCode == 200) {
                rej(link);
                resolve(link);
              } else {
                res();
                links.splice(links.indexOf(link), 1);
                resolve(links[0]);
              }
            });
          })
        }

        // This waits until all promises have completed in order to cache the right link.
        Promise.all(links.map(validateLink)).then((results) => {
          SubDungeonLink.create({
            subDungeonId: sdid, 
            skyozoraLink: null, 
            timestamp: Date.now(),
          });
        }).catch((link) => {
          SubDungeonLink.create({
            subDungeonId: sdid, 
            skyozoraLink: link, 
            timestamp: Date.now(),
          });
        });
      }
    );
  });
}

// Start Server
app.listen(port, () => console.log(`App listening at port ${port}`));
