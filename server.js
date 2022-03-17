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
  sdid = parseInt(req.params.subDungeonId);
  if (isNaN(sdid)) return res.redirect(failedSearchURL);
  SubDungeonLink.findOne({subDungeonId: sdid})
  .exec(async function (err, link) {
    if (link == null) {
      try {
        link = await findLink(sdid);
      } catch (error) {return res.redirect(failedSearchURL);}
      res.redirect(link || failedSearchURL);
      SubDungeonLink.create({
        subDungeonId: sdid, 
        skyozoraLink: link, 
        timestamp: Date.now(),
      });
    } else {
      res.redirect(link.skyozoraLink || failedSearchURL);
    }
  });
});

function findLink(sdid) {
  return new Promise((resolve, reject) => {
    con.query(`SELECT dungeons.name_ja AS dgName, sub_dungeons.name_ja AS sdName
               FROM sub_dungeons 
                    JOIN dungeons ON sub_dungeons.dungeon_id = dungeons.dungeon_id
               WHERE sub_dungeon_id = ?`, [sdid],
      function (err, rows) {
        if (err) throw err;
        if (rows.length == 0) return reject('Invalid sdid');

        function validateLink(link) {
          return new Promise((resolve, reject) => {
            https.get(link, function(res) {
              if (res.statusCode == 200) reject(link);
              else resolve();
            });
          })
        }

        var cleanDgName = rows[0].dgName.replace('/', '／');
        var cleanSdName = rows[0].sdName.replace('/', '／');
        var cleanerDgName = cleanDgName.replace(/【.*】/, '');
        var cleanerSdName = cleanSdName.replace(/【.*】/, '');
        var links = [...new Set([
          `${cleanDgName}/${cleanSdName}`,
          `${cleanerDgName}/${cleanSdName}`,
          `${cleanDgName}/${cleanerSdName}`,
          `${cleanerDgName}/${cleanerSdName}`,
        ].map(path => encodeURI("https://pad.skyozora.com/stage/"+path));

        // This can resolve the outer promise before checking every link.
        if ([...new Set(links)].length == 1) resolve(links[0]);
        links.map(async function (link) {
          https.get(link, function(res) {
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

// Start Server
app.listen(port, () => console.log(`App listening at port ${port}`));
