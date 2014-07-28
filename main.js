(function() {
  var admzip, app, bodyParser, childProcess, clearTempFiles, createTempFilename, downloadSubtitle, express, fs, fsstore, http, io, isSubtitleEnabled, methodOverride, moviedb, omx, path, peerflix, readTorrent, remote, request, rimraf, server, settings, statePlaying, store, subtitleLanguage, tempDir, titlePlaying, torrentStream, tpb, tv, urltool, uuid;

  bodyParser = require('body-parser');

  methodOverride = require('method-override');

  omx = require('omxcontrol');

  readTorrent = require('read-torrent');

  peerflix = require('peerflix');

  uuid = require('node-uuid');

  path = require('path');

  http = require('http');

  urltool = require('url');

  tpb = require('thepiratebay');

  childProcess = require('child_process');

  fs = require('fs');

  rimraf = require('rimraf');

  fsstore = require('fs-memory-store');

  request = require('request');

  admzip = require('adm-zip');

  store = new fsstore(__dirname + '/store');

  moviedb = require('moviedb')('c2c73ebd1e25cbc29cf61158c04ad78a');

  tempDir = require('os').tmpdir();

  express = require('express');

  app = express();

  server = http.Server(app);

  io = require('socket.io')(server);

  torrentStream = null;

  statePlaying = false;

  titlePlaying = "";

  settings = {};

  server.listen(80);

  store.get('settings', function(err, val) {
    if (err === null) {
      return settings = val;
    }
  });

  downloadSubtitle = function(imdb_id, baseurl, cb) {
    var lang;
    lang = subtitleLanguage();
    return request('http://api.' + baseurl + '/subs/' + imdb_id, function(err, res, body) {
      var bestSub, bestSubRating, out, req, result, sub, subs, _i, _len;
      if (err) {
        return cb({
          success: false,
          requesterr: true
        });
      } else {
        result = JSON.parse(body);
        if (result.success) {
          if (result.subs[imdb_id][lang] != null) {
            subs = result.subs[imdb_id][lang];
            bestSub = null;
            bestSubRating = -99;
            for (_i = 0, _len = subs.length; _i < _len; _i++) {
              sub = subs[_i];
              if (sub.rating > bestSubRating) {
                bestSub = sub;
                bestSubRating = sub.rating;
              }
            }
            if (bestSub) {
              out = fs.createWriteStream(__dirname + '/subtitles/subtitle.zip');
              req = request({
                method: 'GET',
                uri: 'http://yifysubtitles.com' + bestSub.url.replace('\\', '')
              });
              req.pipe(out);
              req.on('error', function() {
                return cb({
                  success: false
                });
              });
              return req.on('end', function() {
                var e, entry, zip, zipEntries, _j, _len1;
                try {
                  zip = new admzip(__dirname + '/subtitles/subtitle.zip');
                  zipEntries = zip.getEntries();
                  e = null;
                  for (_j = 0, _len1 = zipEntries.length; _j < _len1; _j++) {
                    entry = zipEntries[_j];
                    if (entry.entryName.indexOf('.srt', entry.entryName.length - 4) !== -1) {
                      e = entry;
                    }
                  }
                  if (e != null) {
                    zip.extractEntryTo(e.entryName, __dirname + '/subtitles', false, true);
                    return cb({
                      success: true,
                      path: __dirname + '/subtitles/' + e.entryName
                    });
                  } else {
                    return cb({
                      success: false
                    });
                  }
                } catch (_error) {
                  return cb({
                    success: false
                  });
                }
              });
            } else {
              return cb({
                success: false
              });
            }
          } else {
            return cb({
              success: false
            });
          }
        } else {
          return cb({
            success: false
          });
        }
      }
    });
  };

  createTempFilename = function() {
    return path.join(tempDir, 'torrentcast_' + uuid.v4());
  };

  clearTempFiles = function() {
    return fs.readdir(tempDir, function(err, files) {
      if (!err) {
        return files.forEach(function(file) {
          if (file.substr(0, 11 === 'torrentcast')) {
            return fs.rmdir(path.join(tempDir, file));
          }
        });
      }
    });
  };

  isSubtitleEnabled = function() {
    if (settings.subtitles != null) {
      return settings.subtitles;
    } else {
      return false;
    }
  };

  subtitleLanguage = function() {
    if (settings.subtitleLanguage != null) {
      return settings.subtitleLanguage;
    } else {
      return "";
    }
  };

  app.use(bodyParser.urlencoded({
    extended: true
  }));

  app.use(bodyParser.json());

  app.use(methodOverride());

  app.set('view engine', 'ejs');

  app.set('views', __dirname + '/views');

  app.use('/static', express["static"](__dirname + '/static'));

  app.get('/', function(req, res, next) {
    return res.render('remote.ejs');
  });

  app.get('/tv', function(req, res, next) {
    return res.render('tv.ejs');
  });

  tv = io.of('/iotv');

  tv.on('connection', function(socket) {
    return console.log("TV Connected!");
  });

  remote = io.of('/ioremote');

  remote.on('connection', function(socket) {
    socket.on('forwardMedia', function() {
      if (statePlaying) {
        return omx.player.forward();
      }
    });
    socket.on('backwardMedia', function() {
      if (statePlaying) {
        return omx.player.backward();
      }
    });
    socket.on('stopMedia', function() {
      if (torrentStream) {
        torrentStream.destroy();
        torrentStream = null;
      }
      statePlaying = false;
      tv.emit('main');
      return omx.player.quit();
    });
    socket.on('pauseplayMedia', function() {
      if (statePlaying) {
        statePlaying = false;
        if (torrentStream) {
          torrentStream.swarm.pause();
        }
      } else {
        statePlaying = true;
        if (torrentStream) {
          torrentStream.swarm.resume();
        }
      }
      return omx.player.pause();
    });
    socket.on('searchEpisodeTorrents', function(string, fn) {
      return tpb.search(string, {
        category: '205'
      }, function(err, results) {
        if (err) {
          return fn({
            success: false,
            error: 'No torrents found!'
          });
        } else {
          return fn({
            success: true,
            torrents: results
          });
        }
      });
    });
    socket.on('searchMovieTorrents', function(imdbid, fn) {
      var url;
      url = 'http://yts.re/api/listimdb.json?imdb_id=' + imdbid;
      return request(url, function(err, res, body) {
        var result;
        if (err) {
          url = 'http://yts.im/api/listimdb.json?imdb_id=' + imdbid;
          return request(url, function(err, res, body) {
            var result;
            if (err) {
              return fn({
                success: false,
                error: 'Could not retrieve a list of torrents!'
              });
            } else {
              result = JSON.parse(body);
              if (result.MovieCount === 0) {
                return fn({
                  success: false,
                  error: 'No torrents found!'
                });
              } else {
                return fn({
                  success: true,
                  torrents: result.MovieList
                });
              }
            }
          });
        } else {
          result = JSON.parse(body);
          if (result.MovieCount === 0) {
            return fn({
              success: false,
              error: 'No torrents found!'
            });
          } else {
            return fn({
              success: true,
              torrents: result.MovieList
            });
          }
        }
      });
    });
    socket.on('getMovie', function(id, fn) {
      return moviedb.movieInfo({
        id: id
      }, function(err, res) {
        if (err) {
          return fn({
            success: false,
            error: 'Could not retrieve the movie!'
          });
        } else {
          return fn({
            success: true,
            movie: res
          });
        }
      });
    });
    socket.on('getSerie', function(id, fn) {
      var url;
      url = 'http://eztvapi.re/show/' + id;
      return request(url, function(err, res, body) {
        var result;
        if (err) {
          return fn({
            success: false,
            error: 'Could not retrieve serie!'
          });
        } else {
          try {
            result = JSON.parse(body);
            return fn({
              success: true,
              serie: result
            });
          } catch (_error) {
            return fn({
              success: false,
              error: 'Could not retrieve serie!'
            });
          }
        }
      });
    });
    socket.on('getPopularSeries', function(page, fn) {
      var url;
      url = 'http://eztvapi.re/shows/' + page;
      return request(url, function(err, res, body) {
        var result;
        if (err) {
          return fn({
            success: false,
            error: 'Could not retrieve series!'
          });
        } else {
          result = JSON.parse(body);
          return fn({
            success: true,
            series: result
          });
        }
      });
    });
    socket.on('getPopularMovies', function(page, fn) {
      return moviedb.miscPopularMovies({
        page: page
      }, function(err, res) {
        if (err) {
          return fn({
            success: false,
            error: 'Could not retrieve any movies!'
          });
        } else {
          return fn({
            success: true,
            movies: res.results
          });
        }
      });
    });
    socket.on('searchSeries', function(data, fn) {
      var query, url;
      query = encodeURIComponent(data.query).replace('%20', '+');
      url = 'http://eztvapi.re/shows/' + data.page + '?keywords=' + query;
      return request(url, function(err, res, body) {
        var result;
        if (err) {
          return fn({
            success: false,
            error: 'Could not retrieve series!'
          });
        } else {
          try {
            result = JSON.parse(body);
            return fn({
              success: true,
              series: result
            });
          } catch (_error) {
            return fn({
              success: false,
              error: 'Could not retrieve series!'
            });
          }
        }
      });
    });
    socket.on('searchMovies', function(data, fn) {
      return moviedb.searchMovie({
        page: data.page,
        query: data.query,
        search_type: 'ngram'
      }, function(err, res) {
        if (err) {
          return fn({
            success: false,
            error: 'Could not retrieve any movies!'
          });
        } else {
          return fn({
            success: true,
            movies: res.results
          });
        }
      });
    });
    socket.on('playTorrent', function(data, fn) {
      tv.emit('loading');
      if ((data.magnet != null) && data.magnet.length > 0) {
        return readTorrent(data.magnet, function(err, torrent) {
          if (err) {
            tv.emit('main');
            return fn({
              success: false,
              error: 'Failure while parsing the magnet link!'
            });
          } else {
            if (torrentStream) {
              torrentStream.destroy();
            }
            torrentStream = null;
            clearTempFiles();
            torrentStream = peerflix(torrent, {
              connections: 100,
              path: createTempFilename(),
              buffer: (1.5 * 1024 * 1024).toString()
            });
            torrentStream.server.on('listening', function() {
              var options, port;
              port = torrentStream.server.address().port;
              statePlaying = true;
              titlePlaying = data.title;
              options = {};
              options.input = 'http://127.0.0.1:' + port + '/';
              if (isSubtitleEnabled() && (data.imdb_id != null)) {
                return rimraf(__dirname + '/subtitles', function() {
                  return fs.mkdir(__dirname + '/subtitles', function() {
                    return downloadSubtitle(data.imdb_id, 'yifysubtitles.com', function(result) {
                      var i, _i, _results;
                      if (result.success) {
                        options.subtitle = result.path;
                        return omx.player.start(options);
                      } else {
                        if (result.requesterr) {
                          return downloadSubtitle(data.imdb_id, 'ysubs.com', function(result) {
                            var i, _i, _results;
                            if (result.success) {
                              options.subtitle = result.path;
                              return omx.player.start(options);
                            } else {
                              _results = [];
                              for (i = _i = 0; _i < 1; i = ++_i) {
                                _results.push(downloadSubtitle(data.imdb_id, 'ysubs.com', function(result) {
                                  if (result.success) {
                                    options.subtitle = result.path;
                                    omx.player.start(options);
                                    break;
                                  } else {
                                    if (i === 1) {
                                      return omx.player.start(options);
                                    }
                                  }
                                }));
                              }
                              return _results;
                            }
                          });
                        } else {
                          _results = [];
                          for (i = _i = 0; _i < 1; i = ++_i) {
                            _results.push(downloadSubtitle(data.imdb_id, 'yifysubtitles.com', function(result) {
                              if (result.success) {
                                options.subtitle = result.path;
                                omx.player.start(options);
                                break;
                              } else {
                                if (i === 1) {
                                  return omx.player.start(options);
                                }
                              }
                            }));
                          }
                          return _results;
                        }
                      }
                    });
                  });
                });
              } else {
                return omx.player.start(options);
              }
            });
            return fn({
              success: true
            });
          }
        });
      } else {
        tv.emit('main');
        return fn({
          success: false,
          error: 'No magnet link received!'
        });
      }
    });
    socket.on('returnState', function(fn) {
      return fn({
        playing: statePlaying,
        title: titlePlaying
      });
    });
    socket.on('getSettings', function(fn) {
      return store.get('settings', function(err, val) {
        if (err) {
          return fn({
            success: false
          });
        } else {
          return fn({
            success: true,
            settings: val
          });
        }
      });
    });
    socket.on('setSettings', function(data, fn) {
      return store.set('settings', data, function(err) {
        if (err) {
          return fn({
            success: false
          });
        } else {
          settings = data;
          return fn({
            success: true
          });
        }
      });
    });
    socket.on('shutdown', function(data, fn) {
      return childProcess.exec('poweroff', function(error, stdout, stderr) {
        return console.log('Bye!');
      });
    });
    return socket.on('reboot', function(data, fn) {
      return childProcess.exec('reboot', function(error, stdout, stderr) {
        return console.log('Bye!');
      });
    });
  });

  omx.emitter.on('stop', function() {
    return childProcess.exec('xrefresh -display :0', function(error, stdout, stderr) {
      remote.emit('stateStop');
      if (error != null) {
        return console.log("Could not give PiTV the authority back!");
      }
    });
  });

  omx.emitter.on('complete', function() {
    return remote.emit('statePlaying', titlePlaying);
  });

}).call(this);
