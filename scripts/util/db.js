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


// db module
let the_module = (function() {
    "use strict";

    const module = { NAME: "db" };
    const log = new logger.Logger(appcfg.APPNAME, module.NAME, appcfg.LOGLEVEL);

    const INDEXED_DB_NAME = "tiptab-db";
    const INDEXED_DB_VERSION = 1;

    let openedDB;       // cached opened db


    // The IndexedDb API is kind of fucked up.  Add adaptors to make it easier to use.

    // Adaptor to turn a request into a promise.
    function pRequest(req) {
        return new Promise(function(resolve, reject) {
            req.onsuccess   = event => resolve(event.target.result);    // pRequest(req).then( result )
            req.onerror     = event => reject(event.target.error);      // pRequest(req).catch( error )
        });
    }

    // Adaptor to turn a transaction into a promise.
    function pTransaction(tx) {
        return new Promise(function(resolve, reject) {
            tx.oncomplete   = event => resolve(event.target.result);    // pRequest(req).then( result )
            tx.onerror      = event => reject(event.target.error);      // pRequest(req).catch( error )
            tx.onabort      = event => reject(event.target.error);      // pRequest(req).catch( error )
        });
    }


    // Create the IndexedDb database and table schema as needed.
    function pCreateDB() {
        let req = window.indexedDB.open(INDEXED_DB_NAME, INDEXED_DB_VERSION);
        req.onupgradeneeded = event => {
            log.info("onupgradeneeded");
            let db = event.target.result;
            if (!db.objectStoreNames.contains("tabImage")) {
                let store = db.createObjectStore("tabImage", { keyPath: "key" });   // Don't change any of the key fieldname; Firefox doesn't seem to like it.
            }
            if (!db.objectStoreNames.contains("imageLastUse")) {
                let store = db.createObjectStore("imageLastUse", { keyPath: "key" });
                store.createIndex("timestamp", "timestamp", { unique: false });
            }
        };
        return pRequest(req);
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

    async function pSaveTabImage(tabUrl, imageDataUrl, dryRun) {
        if (!(tabUrl && imageDataUrl.startsWith("data:image/"))) {
            return Promise.resolve(null);
        }
        let urlhash = new SparkMD5().append(tabUrl).end();
        if (dryRun) {
            return Promise.resolve(urlhash);
        }
        let db      = await pOpenDB();
        let tx      = db.transaction(["tabImage", "imageLastUse"], "readwrite");
        let imStore = tx.objectStore("tabImage");
        let luStore = tx.objectStore("imageLastUse");
        await pRequest(imStore.add({ key: urlhash,  image: imageDataUrl }));    // store mapping of url-hash to image
        await pRequest(luStore.put({ key: urlhash,  timestamp: new Date() }));  // store mapping of url-hash to last-use timestamp; garbage collection will use the timestamp.
        return pTransaction(tx).then( () => urlhash );
    }

    async function pTxRead(storeNames, pTxProcessor) {
        let db = await pOpenDB();
        let tx = db.transaction(storeNames, "readonly");
        let valueObj = await pTxProcessor(tx);
        await pTransaction(tx);
        return valueObj;
    }

    async function pGetRecord(storeName, key) {
        return pTxRead(storeName, tx => pRequest(tx.objectStore(storeName).get(key)));
    }

    function pGetRecordValue(storeName, key, fieldName) {
        return pGetRecord(storeName, key).then(record => record ? record[fieldName] : null);
    }

    function pGetImage(tabUrl) {
        let urlhash = new SparkMD5().append(tabUrl).end();
        return pGetRecordValue("tabImage", urlhash, "image");
    }

    function pGetImageLastUse(tabUrl) {
        let urlhash = new SparkMD5().append(tabUrl).end();
        return pGetRecord("imageLastUse", urlhash).then( lu => lu ? lu.timestamp : null );
    }

    async function pClearImageDb() {
        let db      = await pOpenDB();
        let tx      = db.transaction(["tabImage", "imageLastUse"], "readwrite");
        await pRequest(tx.objectStore("tabImage").clear());
        await pRequest(tx.objectStore("imageLastUse").clear());
        return pTransaction(tx);
    }

    async function pExportImageDb() {
        let db      = await pOpenDB();
        let tx      = db.transaction(["tabImage", "imageLastUse"], "readonly");
        let result  = {
            "tabImage":     await pRequest(tx.objectStore("tabImage").getAll()),
            "imageLastUse": await pRequest(tx.objectStore("imageLastUse").getAll()),
        };
        return pTransaction(tx).then( () => result );
    }

    function validateImportImageDb(dbJson) {
        if (!dbJson["tabImage"]) throw Error("Favicon data 'tabImage' is not found.");
        if (!dbJson["imageLastUse"]) throw Error("Favicon data 'imageLastUse' is not found.");
        return dbJson;
    }
    
    async function pImportImageDb(dbRecordsJson) {
        let stores  = ["tabImage", "imageLastUse"];
        let db      = await pOpenDB();
        let tx      = db.transaction(stores, "readwrite");
        // TODO: get imageLastUse first and merge the timestamps.
        return Promise.all( stores.map( table => pBatchPuts(tx.objectStore(table), dbRecordsJson[table]) ) )
            .then(() => pTransaction(tx));
    }

    async function pBatchPuts(store, records) {
        return new Promise(function(resolve, reject) {
            // Sequential batch inserts in IndexedDB have very poor performance if the onsuccess event of each put is handled.
            // Skip handling the onsuccess events for all puts except the last one.
            let req;
            records.forEach( record => req = store.put(record) );
            req.onsuccess   = event => resolve(event.target.result);    // pBatchPuts(...).then( result )
            req.onerror     = event => reject(event.target.error);      // pBatchPuts(...).catch( error )
        });
    }


    // Module export
    module.pOpenDB = pOpenDB;
    module.closeDB = closeDB;
    module.pSaveTabImage = pSaveTabImage;
    module.pGetImage = pGetImage;
    module.pGetImageLastUse = pGetImageLastUse;
    module.pClearImageDb = pClearImageDb;
    module.pExportImageDb = pExportImageDb;
    module.pImportImageDb = pImportImageDb;
    module.validateImportImageDb = validateImportImageDb;

    log.info("module loaded");
    return module;

}());

export default the_module;

