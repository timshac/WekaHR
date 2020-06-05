
//  1. Enter sheet name where data is to be written below
var LOG_SHEET_NAME = "Log";
var LOG_SHEET_HEADER_ROW = 1;
var SETTINGS_SHEET_NAME = "Settings";
var REGISTERS_SHEET_NAME = "WriteRegisters";
var REGISTERS_FIRST_ROW_NUM = 5;
var WARNING_SHEET_NAME = "Warnings";
var STATUS_SHEET_NAME = "Status";

//  2. Run > setup
//
//  3. Publish > Deploy as web app
//    - enter Project Version name and click 'Save New Version'
//    - set security level and enable service (most likely execute as 'me' and access 'anyone, even anonymously)
//
//  4. Copy the 'Current web app URL' and post this in your form/script action
//
//  5. Insert column names on your destination sheet matching the parameter names of the data you are passing in (exactly matching case)


//var SCRIPT_PROP = PropertiesService.getScriptProperties(); // new property service
var DOC_PROP = PropertiesService.getDocumentProperties(); 

// If you don't want to expose either GET or POST methods you can comment out the appropriate function
function doGet(e){
  return handleResponse(e.parameter);
}

function doPost(e){
  return handleResponse(e.parameter);
}

function handleResponse(parameter) {
  // shortly after my original solution Google announced the LockService[1]
  // this prevents concurrent access overwritting data
  // [1] http://googleappsdeveloper.blogspot.co.uk/2011/10/concurrency-and-google-apps-script.html
  // we want a public lock, one that locks for all invocations
  //var lock = LockService.getPublicLock();
  //lock.waitLock(30000);  // wait 30 seconds before conceding defeat.

  try {
    // next set where we write the data - you could write to multiple/alternate destinations
    var doc = SpreadsheetApp.openById(DOC_PROP.getProperty("key"));
    var sheet = doc.getSheetByName(LOG_SHEET_NAME);
    var registers_sheet = doc.getSheetByName(REGISTERS_SHEET_NAME);
    var settings_sheet = doc.getSheetByName(SETTINGS_SHEET_NAME);
    var LogSheetRetainNum = settings_sheet.getRange(1,2).getValue(); 
    
    var tz = doc.getSpreadsheetTimeZone();
    
        
    // get Registers to return to particle.
    var results = registers_var(registers_sheet);
    results["sheet"] = doc.getUrl();
    
    //sheet.appendRow(["one" + JSON.stringify(parameter)]);
    var data = JSON.parse(parameter["data"]);
    data["coreid"] = parameter["coreid"];
    data["event"] = parameter["event"];
    data["published_at"] = parameter["published_at"];
    
    
    if (data["v"] == "1.0") {
      for (c in data["HR"]) {
        data[c.toString()] = data["HR"][c];
      }
      //sheet.appendRow(["two" + JSON.stringify(data)]);
      if (data["func"] == "writeLog" || data["func"] == "SyncNow"  ) {
        
         //sheet.appendRow(["three" + JSON.stringify(data)]);
        
        var pub_at = MomentFromDateString(data["published_at"])  
        data["published_at_local"] = fromUtc(pub_at,tz)  // "Pacific/Auckland"
        
        var tmp = moment(pub_at)
        var round_1min = tmp.add(30, 'seconds').startOf('minute') 
        data["published_at_local_1min"] = fromUtc(round_1min,tz)  // "Pacific/Auckland"
        
        var tmp2 = moment(pub_at)
        var round_1hr = tmp2.add(30, 'minutes').startOf('hour') 
        data["published_at_local_1hr"] = fromUtc(round_1hr,tz)  // "Pacific/Auckland"
        
        var headers = sheet.getRange(LOG_SHEET_HEADER_ROW, 1, 1, sheet.getLastColumn()).getValues()[0];
        var row = [];
        // loop through the header columns
        for (i in headers){
          if (headers[i] == "published_at"){ // special case 
            var dt = data[headers[i]]  // 2019-02-06T01:10:57.311Z
            dt = dt.replace("T"," ")
            dt = dt.replace("Z"," ")
            row.push(dt);
          } else { // else use header name to get data
            if (headers[i] in data) {
              row.push(data[headers[i]]);
            } else {
              // Look in data
              row.push(data[headers[i]]);
            }
          }
        }
      
        // SAVE WARNINGS SHEET LENGTH
        warningsSheet = doc.getSheetByName(WARNING_SHEET_NAME);
        var oldWarningsRow = warningsSheet.getRange(5,2).getValue(); // doesn't work with array formula: warningsSheet.getLastRow()+1
        
        //row = Object.keys(e.parameter)
        // more efficient to set values as [][] array than individually
        //row.push("hi"+ new Date()) 
        var nextRow = sheet.getLastRow()+1; // get next row
        //sheet.getRange(nextRow, 1, 1, row.length).setValues([row]); 
        
        sheet.appendRow(row);
  
        // WARNINGS SHEET - IF CHANGED, SEND EMAIL
        //SpreadsheetApp.flush();
        var newWarningsRow = warningsSheet.getRange(5,2).getValue(); // doesn't work with array formula: warningsSheet.getLastRow()+1
        if (newWarningsRow > oldWarningsRow) {
          var statusSheet = doc.getSheetByName(STATUS_SHEET_NAME);
          sendWarningEmail(doc,oldWarningsRow,newWarningsRow)
        }
        
        // {"result":"success", "row": nextRow, "flag":1});
        results["row"] = nextRow;
       
        
        //debugLog("message");
        while ( sheet.getLastRow() > LogSheetRetainNum ) {
          sheet.deleteRows(LOG_SHEET_HEADER_ROW+1, 1);
        }
         
        }
    }
   
    //results["result"] = "success";
    //results["flag"] = 1;
    
    // return json success results
    return ContentService
          .createTextOutput(JSON.stringify(results))
          .setMimeType(ContentService.MimeType.JSON);
    
  } catch(e){
    // if error return this
    Logger.log(JSON.stringify({"result":"error", "error": e}));
    return ContentService
          .createTextOutput(JSON.stringify({"result":"error", "error": e}))
          .setMimeType(ContentService.MimeType.JSON);
  } finally { //release lock
    //lock.releaseLock();
  }
  
}

function Setup() {
    var doc = SpreadsheetApp.getActiveSpreadsheet();
    DOC_PROP.setProperty("key", doc.getId());
}

function registers_var(sheet) {
  //var result = {"test":1};

  var lastRow = sheet.getLastRow();
  
  var keys = sheet
    .getRange(REGISTERS_FIRST_ROW_NUM,1,lastRow-REGISTERS_FIRST_ROW_NUM+1)
    .getValues()
  var values = sheet
    .getRange(REGISTERS_FIRST_ROW_NUM,2,lastRow-REGISTERS_FIRST_ROW_NUM+1)
    .getValues()
  /**
   * Reduce keys and values into an object.
   */
  var result = keys.reduce(
    function(accumulator, current, index) {
      accumulator[current] = to_unsigned16(values[index][0])
      return accumulator
    },
    {}
  )

  
  return result;
}

function to_unsigned16(obj) {

  var val = 0;
  try {
    val = Math.round(obj);
  } catch(e) {
    val = 0; 
  }
  
  if (isNaN(val)) { val = 0; }
  if (val > 65536) { val = 65536; }
  if (val < 0 ) { val = 0; }
  
  return val;

}

function registers_test() {
    
  var doc = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = doc.getSheetByName(REGISTERS_SHEET_NAME);
  
  Logger.log(JSON.stringify(registers_var(sheet)));
}

function to_unsigned16_test() {
  Logger.log(to_unsigned16("foo"));
}


function json_text() {
  parameters = JSON.parse('{"v":"1.0","func":"writeLog","addr":0,"HR":[34,40,456,4444,12,0,1,23,8,0,0,0,0,0,0,0,0,0,2048,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,1,2,1,4,5,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,12]}');
  parameters["published_at"] = "2019-10-08T22:46:45Z";
  parameters["coreid"] = "testing_id";
  parameters["event"] = "modbus";
  handleResponse(parameters);
}


function MomentFromDateString(datumString){   
  /* @param datumString: can be passed in by another function in your code
  If not provided, this function uses an example as returned by a stockQuoting RESTserver:
  */
  if(!datumString) datumString = "2019-02-06T01:10:57.311Z";     // 06-02-2019 01:10:57   2019-02-06 00:10:57
  //--- parsing the string; datevalues   
  var splits      = datumString.split("T")
  var datumSplits = splits[0].split("-")
  var dd   = Number(datumSplits[2]);
  var MM   = Number(datumSplits[1])-1;
  var yyyy = Number(datumSplits[0]);   
  //---parsing the string; time values
  var tijd      = splits[1].split("Z")
  var minuutUur = tijd[0].split(":")
  var uur    = Number(minuutUur[0]);
  var minuut = Number(minuutUur[1]);
  var seconds = Number(minuutUur[2]);
  //--- constructing dateValue, with possibilty to be formatted by Utilties             
  //var datumWaarde = new Date(yyyy,MM,dd,uur,minuut,seconds);
  var datumWaarde = moment.utc([yyyy,MM,dd,uur,minuut,seconds]);
  //var werkDatum = Utilities.formatDate(new Date(datumWaarde), "GMT+12", "yyyy-MM-dd HH:mm:ss");  // GMT+2
  //var werkDatum =  fromUtc(datumWaarde, timezone)
  //Logger.log(werkDatum);
  return(datumWaarde)
 }


var DT_FORMAT = 'YYYY-MM-DD HH:mm:ss';

/**
https://stackoverflow.com/questions/34946815/timezone-conversion-in-a-google-spreadsheet/40324587
*/
function toUtc(dateTime, timeZone) {  
  var from = moment.tz(dateTime, DT_FORMAT, timeZone);//https://momentjs.com/timezone/docs/#/using-timezones/parsing-in-zone/
  return from.utc().format(DT_FORMAT);
}

/**
https://stackoverflow.com/questions/34946815/timezone-conversion-in-a-google-spreadsheet/40324587
*/
function fromUtc(dateTime, timeZone) {
  var from = moment.utc(dateTime, DT_FORMAT);//https://momentjs.com/timezone/docs/#/using-timezones/parsing-in-zone/
  return from.tz(timeZone).format(DT_FORMAT);
}

function sendWarningEmail(doc,a,b) {

   // Optional init, to ensure the spreadsheet config overrides the script's
  var conv = SheetConverter.init(doc.getSpreadsheetTimeZone(),doc.getSpreadsheetLocale());
  var warningsSheet = doc.getSheetByName(WARNING_SHEET_NAME);
  var statusSheet = doc.getSheetByName(STATUS_SHEET_NAME);
  
  var email_to = warningsSheet.getRange(2,2).getValue();    // Cell in spreadsheet
  var subject = warningsSheet.getRange(3,2).getValue();    // Cell in spreadsheet
  var sender_name = doc.getName(); // Spreadsheet file name

  // Get a html table version, with all formatting
  var html = conv.convertRange2html(statusSheet.getRange('A2:C17'));
  //Logger.log(html);
  
  var sheet_url = doc.getUrl();
  var console_url = "https://console.particle.io/devices/" + statusSheet.getRange('B3').getValue();


  if (validateEmail(email_to) ) {
    MailApp.sendEmail(email_to, subject,'' ,
      {name: sender_name,htmlBody: 
      "<a href='" + console_url + "'>Particle Console</a>, <a href='"+ sheet_url +"'>Spreadsheet</a>" + "</br></br>" +
      html + "</br></br>"
       })
     
     }

}

function validateEmail(email) {
    var re = /^\S+@\S+$/;
    return re.test(String(email).toLowerCase());
}


function debugLog(msg) {
    //var doc = SpreadsheetApp.openById(DOC_PROP.getProperty("key"));
    //var debugsheet = doc.getSheetByName("Debug");
    //if (debugsheet) { debugsheet.appendRow([msg]); }
}


function onOpen() {
  var ui = SpreadsheetApp.getUi();
  // Or DocumentApp or FormApp.
  ui.createMenu('WekaHR')
      //.addItem('First item', 'menuItem1')
      .addSeparator()
      .addSubMenu(ui.createMenu('Setup')
          .addItem('Initialize Google Sheet', 'menuSetup'))
      .addToUi();
}

function menuItem1() {
  SpreadsheetApp.getUi() // Or DocumentApp or FormApp.
     .alert('You clicked the first menu item!');
}

function menuSetup() {
  Setup();
  
  var serv = ScriptApp.getService();
  var url = serv.getUrl();
  
 // if (serv.isEnabled()) {
    SpreadsheetApp.getUi() // Or DocumentApp or FormApp.
       .alert('App is Setup');
  //} else {
  //  SpreadsheetApp.getUi() // Or DocumentApp or FormApp.
  //     .alert('Enable the Web App in Tools:Script Editor, Publish:Deploy as Web App');
 //}
}

