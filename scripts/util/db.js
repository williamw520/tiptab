/*
  Tip Tab
  A Firefox extension to manage and navigate the browser tabs.
  Copyright (C) 2018  William Wong (williamw520@gmail.com)

  This program is free software: you can redistribute it and/or modify
  it under the terms of the GNU General Public License as published by
  the Free Software Foundation, either version 3 of the License, or
  (at your option) any later version.

  This program is distributed in the hope that it will be useful,
  but WITHOUT ANY WARRANTY; without even the implied warranty of
  MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
  GNU General Public License for more details.

  You should have received a copy of the GNU General Public License
  along with this program.  If not, see <http://www.gnu.org/licenses/>.
*/

// Non-ES6 global includes:
// <script src="/pkg/spark-md5/spark-md5.min.js"></script>

import logger from "/scripts/util/logger.js";
import appcfg from "/scripts/util/appcfg.js";
import dbutil from "/scripts/util/dbutil.js";
import app from "/scripts/util/app.js";


// db module
let the_module = (function() {
    "use strict";

    const module = { NAME: "db" };
    const log = new logger.Logger(appcfg.APPNAME, module.NAME, appcfg.LOGLEVEL);

    const INDEXED_DB_NAME = "tiptab-db";
    const INDEXED_DB_VERSION = 1;

    let openedDB;       // cached opened db


    // Create the IndexedDb database and table schema as needed.
    function pCreateDB() {
        let req = window.indexedDB.open(INDEXED_DB_NAME, INDEXED_DB_VERSION);
        req.onupgradeneeded = event => {
            log.info("onupgradeneeded");
            let db = event.target.result;
            if (!db.objectStoreNames.contains("TabImage")) {
                let store = db.createObjectStore("TabImage", { keyPath: "key" });   // Don't change any of the key fieldname; Firefox doesn't seem to like it.
                store.createIndex("updated", "updated", { unique: false });
            }
        };
        return dbutil.pRequest(req);
    }

    function pOpenDB() {
        if (openedDB) {
            return Promise.resolve(openedDB);
        } else {
            return pCreateDB().then( db => openedDB = db );             // save and return db.
        }
    }

    function closeDB() {
        if (openedDB) {
            openedDB.close();
            openedDB = null;
        }
    }

    function pDeleteDB(reallyDeleteIt) {
        if (reallyDeleteIt) {
            let req = window.indexedDB.deleteDatabase(INDEXED_DB_NAME);
            return dbutil.pRequest(req);
        } else {
            return Promise.resolve();
        }
    }


    async function pSaveTabImage(tabUrl, imageDataUrl, dryRun) {
        if (!(tabUrl && imageDataUrl.startsWith("data:image/"))) {
            return Promise.resolve(null);
        }
        let urlhash = new SparkMD5().append(tabUrl).end();
        if (dryRun) {
            return Promise.resolve(urlhash);
        }
        let db      = await pOpenDB();
        let tx      = db.transaction(["TabImage"], "readwrite");
        let imStore = tx.objectStore("TabImage");
        let ts      = new Date();
        await dbutil.pRequest(imStore.put({ key: urlhash,  image: imageDataUrl,  updated: ts }));   // store mapping of url-hash to image
        return dbutil.pTransaction(tx).then( () => urlhash );
    }

    function pGetTabImage(tabUrl) {
        log.timeSet("pGetTabImage", "start");
        let urlhash = new SparkMD5().append(tabUrl).end();
        return dbutil.pGetRecord(pOpenDB, "TabImage", urlhash)
            .then( x => (log.timeOn("pGetTabImage", "done"), x) );
    }

    // Set fromDate to null to start from the beginning of time.
    // Set toDate to null to the most recent time.
    async function pQueryByRange(rangeFrom, rangeTo, fields) {
        let records = [];
        await dbutil.pIterateByRange(pOpenDB, "TabImage", "updated", "readonly", rangeFrom, rangeTo, (cursor) => {
            records.push(fields ? app.pick(cursor.value, ...fields) : cursor.value);   // accumulate the records, with the selected fields.
        });
        return records;
    }

    async function pDeleteByRange(rangeFrom, rangeTo) {
        let deletedCount = 0;
        await dbutil.pIterateByRange(pOpenDB, "TabImage", "updated", "readwrite", rangeFrom, rangeTo, (cursor) => {
            cursor.delete();
            deletedCount++;
        });
        return deletedCount;
    }

    async function pClearImageDb() {
        let db      = await pOpenDB();
        let tx      = db.transaction(["TabImage"], "readwrite");
        await dbutil.pRequest(tx.objectStore("TabImage").clear());
        return dbutil.pTransaction(tx);
    }

    async function pExportImageDb() {
        let db      = await pOpenDB();
        let tx      = db.transaction(["TabImage"], "readonly");
        let result  = {
            "TabImage":     await dbutil.pRequest(tx.objectStore("TabImage").getAll()),
        };
        return dbutil.pTransaction(tx).then( () => result );
    }

    function validateImportImageDb(dbJson) {
        if (!dbJson["TabImage"]) throw Error("Favicon data 'TabImage' is not found.");
        return dbJson;
    }
    
    async function pImportImageDb(dbRecordsJson) {
        let stores  = ["TabImage"];
        let db      = await pOpenDB();
        let tx      = db.transaction(stores, "readwrite");
        return Promise.all( stores.map( table => dbutil.pBatchPuts(tx.objectStore(table), dbRecordsJson[table]) ) )
            .then(() => dbutil.pTransaction(tx));
    }


    // Module export
    module.pOpenDB = pOpenDB;
    module.closeDB = closeDB;
    module.pDeleteDB = pDeleteDB;
    module.pSaveTabImage = pSaveTabImage;
    module.pGetTabImage = pGetTabImage;
    module.pQueryByRange = pQueryByRange;
    module.pDeleteByRange = pDeleteByRange;
    module.pClearImageDb = pClearImageDb;
    module.pExportImageDb = pExportImageDb;
    module.pImportImageDb = pImportImageDb;
    module.validateImportImageDb = validateImportImageDb;

    log.info("module loaded");
    return module;

}());

export default the_module;

