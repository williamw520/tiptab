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

import logger from "/scripts/util/logger.js";
import appcfg from "/scripts/util/appcfg.js";


// Setting module
let the_module = (function() {
    "use strict";

    const module = { NAME: "settings" };
    const log = new logger.Logger(appcfg.APPNAME, module.NAME, appcfg.LOGLEVEL);


    class TipTabSettings {

        static ofLatest() {
            return new TipTabSettings()._newVersion4();
        }

        static upgradeWith(jsonObj) {
            return TipTabSettings.ofLatest()._fromObj(jsonObj);     // initialize with latest version, then override with the data object.
        }

        static loadAs(jsonObj) {
            let ttSettings = new TipTabSettings();
            ttSettings._version = jsonObj._version;                 // preserve the version from the jsonObj
            return ttSettings._fromObj(jsonObj);
        }

        constructor() {
            this._type = "TipTabSettings";
        }

        _fromObj(jsonObj) {
            switch (jsonObj._version) {
            case 1:
                return this._fromVersion1(jsonObj);
            case 2:
                return this._fromVersion2(jsonObj);
            case 3:
                return this._fromVersion3(jsonObj);
            case 4:
                return this._fromVersion4(jsonObj);
            default:
                throw Error("Unsupported object version " + jsonObj._version);
            }
        }

        _newVersion1() {
            this._version               = 1;
            this.thumbnailPopup         = true;
            this.showEmptyWindows       = false;
            this.showEmptyContainers    = true;
            this.realtimeUpdateThumbnail= true;
            this.enableCustomHotKey     = true;
            this.appHotKey = "";
            return this;
        }

        _fromVersion1(jsonObj) {
            this.thumbnailPopup         = jsonObj.hasOwnProperty("thumbnailPopup") ? jsonObj.thumbnailPopup : true;
            this.showEmptyWindows       = jsonObj.hasOwnProperty("showEmptyWindows") ? jsonObj.showEmptyWindows : false;
            this.showEmptyContainers    = jsonObj.hasOwnProperty("showEmptyContainers") ? jsonObj.showEmptyContainers : true;
            this.realtimeUpdateThumbnail= jsonObj.hasOwnProperty("realtimeUpdateThumbnail") ? jsonObj.realtimeUpdateThumbnail : true;
            this.enableCustomHotKey     = jsonObj.hasOwnProperty("enableCustomHotKey") ? jsonObj.enableCustomHotKey : true;
            this.appHotKey              = jsonObj.appHotKey || "";
            return this._validate1();
        }

        _validate1() {
            // Enforce hotkey string format as XX+XX+XX
            if (this.appHotKey.indexOf("-") >= 0) {
                this.appHotKey = this.appHotKey.replace(/\-/g, "+");
            }
            return this;
        }

        _newVersion2() {
            this._newVersion1();
            this._version               = 2;
            this.thumbnailWidth0        = "8.00rem";
            this.thumbnailHeight0       = "4.50rem";
            this.thumbnailWidth1        = "12.00rem";
            this.thumbnailHeight1       = "6.75rem";
            this.thumbnailWidth2        = "17.77rem";
            this.thumbnailHeight2       = "10.00rem";
            return this;
        }

        _fromVersion2(jsonObj) {
            this._fromVersion1(jsonObj);
            this.thumbnailWidth0        = jsonObj.hasOwnProperty("thumbnailWidth0")  ? jsonObj.thumbnailWidth0  : "8.0rem";
            this.thumbnailHeight0       = jsonObj.hasOwnProperty("thumbnailHeight0") ? jsonObj.thumbnailHeight0 : "4.50rem";
            this.thumbnailWidth1        = jsonObj.hasOwnProperty("thumbnailWidth1")  ? jsonObj.thumbnailWidth1  : "12.00rem";
            this.thumbnailHeight1       = jsonObj.hasOwnProperty("thumbnailHeight1") ? jsonObj.thumbnailHeight1 : "6.75rem";
            this.thumbnailWidth2        = jsonObj.hasOwnProperty("thumbnailWidth2")  ? jsonObj.thumbnailWidth2  : "17.77rem";
            this.thumbnailHeight2       = jsonObj.hasOwnProperty("thumbnailHeight2") ? jsonObj.thumbnailHeight2 : "10.00rem";
            return this._validate2();
        }

        _validate2() {
            return this;
        }
        
        _newVersion3() {
            this._newVersion2();
            this._version               = 3;
            this.searchHotKey           = "";
            return this;
        }

        _fromVersion3(jsonObj) {
            this._fromVersion2(jsonObj);
            this.searchHotKey           = jsonObj.searchHotKey || "";
            return this._validate3();
        }

        _validate3() {
            if (this.searchHotKey.indexOf("-") >= 0) {
                this.searchHotKey = this.searchHotKey.replace(/\-/g, "+");
            }
            return this;
        }
        
        _newVersion4() {
            this._newVersion3();
            this._version               = 4;
            this.openInNewWindow        = true;
            this.savedSearchKeyPrefix   = "Ctrl+Shift+";
            return this;
        }

        _fromVersion4(jsonObj) {
            this._fromVersion2(jsonObj);
            this.openInNewWindow        = jsonObj.hasOwnProperty("openInNewWindow") ? jsonObj.openInNewWindow : true;
            this.savedSearchKeyPrefix   = jsonObj.hasOwnProperty("savedSearchKeyPrefix") ? jsonObj.savedSearchKeyPrefix : "Ctrl+Shift+";
            return this._validate4();
        }

        _validate4() {
            return this;
        }
        
    }

    function pLoad() {
        return browser.storage.local.get("tipTabSettings")
            .then( results => {
                return results && results.hasOwnProperty("tipTabSettings") ?
                    TipTabSettings.upgradeWith(results.tipTabSettings) : TipTabSettings.ofLatest();
            })
            .catch( e => {
                log.warn(e);
                return TipTabSettings.ofLatest();
            })
    }

    function pSave(ttSettings) {
        return browser.storage.local.set({ "tipTabSettings": ttSettings });
    }

    function pRemove() {
        return browser.storage.local.remove("tipTabSettings");
    }

    function pUpdate(property, value) {
        return pLoad().then(ttSettings => {
            ttSettings[property] = value;
            return ttSettings;
        }).then(pSave)
    }
    

    // Module export
    module.TipTabSettings = TipTabSettings;
    module.pLoad = pLoad;
    module.pSave = pSave;
    module.pRemove = pRemove;
    module.pUpdate = pUpdate;

    log.info("module loaded");
    return module;

}());

export default the_module;


