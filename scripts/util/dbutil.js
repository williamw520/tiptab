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


// dbutil module
let the_module = (function() {
    "use strict";

    const module = { NAME: "dbutil" };
    const log = new logger.Logger(appcfg.APPNAME, module.NAME, appcfg.LOGLEVEL);

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

    // Do a transactional read.
    async function pTxRead(pDbGetter, storeNames, pTxProcessor) {
        let db = await pDbGetter();
        let tx = db.transaction(storeNames, "readonly");
        let valueObj = await pTxProcessor(tx);
        await pTransaction(tx);
        return valueObj;
    }

    // Get a record
    async function pGetRecord(pDbGetter, storeName, key) {
        return pTxRead(pDbGetter, storeName, tx => pRequest(tx.objectStore(storeName).get(key)));
    }

    // Get a field of a record
    function pGetRecordField(pDbGetter, storeName, key, fieldName) {
        return pGetRecord(pDbGetter, storeName, key).then(record => record ? record[fieldName] : null);
    }

    // Do batch puts
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
    module.pRequest = pRequest;
    module.pTransaction = pTransaction;
    module.pGetRecord = pGetRecord;
    module.pGetRecordField = pGetRecordField;
    module.pBatchPuts = pBatchPuts;

    log.info("module loaded");
    return module;

}());

export default the_module;

