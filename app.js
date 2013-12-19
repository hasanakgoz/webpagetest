"use strict";

var fs = require('fs');
var mongoClient = require('mongodb').MongoClient;
var key = require("./key");
var WebPageTest = require('webpagetest');
var wpt = new WebPageTest('www.webpagetest.org', key.appKey);

var testDate = new Date();
console.log('Webpagetest initiated at ' + testDate.getHours() + ' on ' + testDate.getFullYear() + '-' + testDate.getMonth() + '-' + testDate.getDate() );

/*
 * Array of pages to test
 * Should be a good cross-section of each unique page type
 * Limited to 200 requests/day by our public key
 */
var testPages = [
  {
    'brand': 'NY Mag',
    'type': 'homepage',
    'url': 'http://nymag.com'
  },
  {
    'brand': 'NY Mag',
    'type': 'restaurant picks',
    'url': 'http://nymag.com/srch?t=restaurant&N=265+336&No=0&Ns=nyml_sort_name%7C0'
  },
  {
    'brand': 'Daily Intel',
    'type': 'article',
    'url': 'http://nymag.com/daily/intelligencer/2013/12/jp-morgan-eases-up-on-young-bankers.html'
  },
  {
    'brand': 'Vulture',
    'type': 'homepage',
    'url': 'http://www.vulture.com/'
  },
  {
    'brand': 'Vulture',
    'type': 'article',
    'url': 'http://www.vulture.com/2013/12/saltz-how-not-wait-in-line-for-yayoi-kusama.html'
  },
  {
    'brand': 'The Cut',
    'type': 'homepage',
    'url': 'http://nymag.com/thecut/'
  },
  {
    'brand': 'The Cut',
    'type': 'article',
    'url': 'http://nymag.com/thecut/2013/12/real-reason-20-something-women-are-worried.html'
  },
  {
    'brand': 'The Cut',
    'type': 'slideshow',
    'url': 'http://nymag.com/thecut/2012/08/kate-middleton-look-book/slideshow/2012/07/30/kate_middleton_lookbook/'
  },
  {
    'brand': 'Grub Street',
    'type': 'homepage',
    'url': 'http://www.grubstreet.com/'
  },
  {
    'brand': 'Grub Street',
    'type': 'article',
    'url': 'http://www.grubstreet.com/2013/12/whole-foods-bryant-park.html'
  }
];

mongoClient.connect('mongodb://localhost:55555/webpagetest', {}, function(err,db) {

  if (err) throw err;

  var progress = {
    'totalPages': testPages.length,
    'totalSuccess': 0,
    'totalFail': 0,
    'start' : function() {
      requestFromWebpagetest();
      //createGraphs();
    },
    'moveOn': function(error) {
      if ( ! error) {
        this.totalSuccess += 1;
      } else {
        this.totalFail += 1;
        console.log(error.toString());
      }
      if (this.totalPages === (this.totalSuccess + this.totalFail)) {
        // go to next step
        createGraphs();
      }
    },
    'done': function() {
      console.log('Total pages tested: ' + this.totalSuccess + '. Total pages not tested: ' + this.totalFail + '.');
      //db.close();
    }
  };

  function requestFromWebpagetest() {
    testPages.forEach(function(testPage, i, a){
      wpt.runTest(testPage.url, function(err, data) {
        if (err) {
          progress.moveOn(err);
        } else {
          console.log('Submitting test request for ' + testPage.url);
          var testId = data.data.testId;
          var totalWaitMinutes = 0;
          checkForResults();
        }
        function checkForResults() {
          wpt.getTestResults(testId, function(err, data) {
            if (err) {
              progress.moveOn(err);
            } else {
              var minutesToWait = 5;
              switch (Math.floor(data.response.statusCode/100)) {
                case 1:
                  console.log('Results still in progress for ' + testPage.url + '. Trying again in ' + minutesToWait + ' minutes.');
                  totalWaitMinutes += minutesToWait;
                  if (totalWaitMinutes > minutesToWait*10) {
                    progress.moveOn('Aborting: response took more than ' + (minutesToWait*10) + ' minutes.');
                  } else {
                    setTimeout(checkForResults,minutesToWait*60*1000);
                  }
                  break;
                case 2:
                  console.log('Results receieved for ' + testPage.url);
                  // add page information to results object
                  data.page = testPage;
                  db.collection('results').insert(data, function(err, inserted) {
                    if (err) console.log(err.message);
                    console.dir(testPage.url + ' successfully saved to database.');
                    progress.moveOn();
                  });
                  break;
                default:
                  progress.moveOn('Error: ' + data.response.statusCode + ' ' + data.response.statusText);
                  break;
              }
            }
          });
        }
      });
    });
  }

  function createGraphs() {

    /* Query mongodb for:

     response.data.completed == date of test
     response.data.testUrl == test url

     response.data.run.firstView.results.
         "URL" : "http://nymag.com",
         "domTime" : 0,
         * "TTFB" : 168, (time from http request to receiving first byte)
         ? "render" : 192, ??? page stops being blank?
         "renderDT" : 194, ???
         * "firstPaint" : 207,
         * "titleTime" : 282,
         * "domContentLoadedEventStart" : 1896, = $(document).ready()
         * "domContentLoadedEventEnd" : 1981,
         "docTime" : 4456,
         "loadTime" : 4456,
         * "loadEventStart" : 4471,
         "loadEventEnd" : 4472,
         * "fullyLoaded" : 5708,
         "lastVisualChange" : 7695,
         * "VisuallyCompleteDT" : 7695,
         "visualComplete" : 7695,

     Add later:
     response.data.run.repeatView.results.

    */

    console.log('Query MongoDB.');
    db.collection('results').aggregate([
      {
        $project : {
          _id : 0,
          date: '$response.data.completed',
          url: '$response.data.testUrl',
          firstByte: '$response.data.run.firstView.results.TTFB',
          firstPaint: '$response.data.run.firstView.results.firstPaint',
          titleLoad: '$response.data.run.firstView.results.titleTime',
          docReadyStart: '$response.data.run.firstView.results.domContentLoadedEventStart',
          docReadyEnd: '$response.data.run.firstView.results.domContentLoadedEventEnd',
          docLoadStart: '$response.data.run.firstView.results.loadEventStart',
          docLoadEnd: '$response.data.run.firstView.results.loadEventEnd',
          loaded: '$response.data.run.firstView.results.fullyLoaded',
          visuallyComplete: '$response.data.run.firstView.results.VisuallyCompleteDT'
        }
      },
      {
        $sort: {
          date: 1
        }
      }
    ],function(err, results) {
      if (err) throw err;
      db.close();

      // Create graphs from data
      console.log('Creating useful graphs from mongodb data.');
      // Format HTML
      var htmlOutput = '<html><head><title>WebPageTest Results</title></head><body>' +
                       '<link href="stylesheets/graph.css" media="all" rel="stylesheet" />' +
                       '<script>var JSONData = ' + JSON.stringify(results) + ';</script>' +
                       '<script src="javascripts/d3.v3/d3.v3.min.js"></script>' +
                       '<script src="javascripts/graph-config.js"></script>' +
                       '</body></html>';

      // Save to file
      var resultsFile = __dirname + '/public/results.html';
      fs.writeFile(resultsFile , htmlOutput, function(err) {
        if(err) {
          console.log(err);
        } else {
          console.log('Results saved to ' + resultsFile + '!');
        }
      });


    });

    /*
    console.log('Creating useful graphs from mongodb data.');
    console.log('Generate graphs (using package?).');
    console.log('Save html graph file or image?.');
    console.log('Send email if necessary.');
    console.log('Close database connection and quit the app.');
    progress.done();

    */
  }


  // Start the process
  progress.start();

});
