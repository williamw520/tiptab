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


// dlg module
let the_module = (function() {
    "use strict";

    const module = { NAME: "dlg" };
    const log = new logger.Logger(appcfg.APPNAME, module.NAME, appcfg.LOGLEVEL);


    function setupDlg(dlgElementSelector, enterKeyToClose) {
        let $modal = $(dlgElementSelector);

        function gatherInputValues() {
            let inputValues = $modal.data("inputValues");
            Object.keys(inputValues).forEach( key => {
                let $elem = $modal.find(key);
                if ($elem.is("input:radio")) {
                    $elem.each( function() {
                        if ($(this).is(":checked"))
                            inputValues[key] = $(this).val();
                    });
                } else if ($elem.is("input:file")) {
                    inputValues[key] = $elem.get(0).files;                  // return an array of File objects (HTML5 File type).
                } else if ($elem.is("input") || $elem.is("textarea")) {
                    inputValues[key] = $elem.val();
                }
            });
            return inputValues;
        }

        function close() {
            let onClose = $modal.data("onClose");
            if (onClose)
                onClose(gatherInputValues());
            $modal.removeClass("active");
        }

        function submit() {
            let onSubmit = $modal.data("onSubmit");
            if (onSubmit)
                onSubmit(gatherInputValues());
            $modal.removeClass("active");
        }

        $modal.on("click", ".modal-close, .modal-cancel", close)
        $modal.on("click", ".modal-submit", submit);
        $modal.on("keypress", function(e){
            if (e.keyCode == 13) {
                e.preventDefault();
                if (enterKeyToClose)
                    close();
                else
                    submit();
            }
        });
    }

    function openDlg(dlgElementSelector, inputValues, htmlTexts, elementPropertiesMap, focusSelector, onSubmit, onClose) {
        let $modal = $(dlgElementSelector);
        for (let selectorKey in inputValues) {
            let $elem = $modal.find(selectorKey);
            if ($elem.length) {
                if ($elem.is("input") || $elem.is("textarea"))
                    $elem.val(inputValues[selectorKey]);
                else
                    $elem.text(inputValues[selectorKey]);   // safe text substitution
            }
        }
        for (let selectorKey in htmlTexts) {
            let $elem = $modal.find(selectorKey);
            if ($elem.length) {
                $elem.html(htmlTexts[selectorKey]);         // unsafe text substitution
            }
        }
        for (let selectorKey in (elementPropertiesMap || {})) {
            let $elem = $modal.find(selectorKey);
            if ($elem.length) {
                let propertiesForElem = elementPropertiesMap[selectorKey];
                $elem.prop(propertiesForElem);
            }
        }
        $modal.data("onSubmit", onSubmit);
        $modal.data("onClose", onClose);
        $modal.data("inputValues", inputValues);
        $modal.addClass("active");
        $modal.find(focusSelector).focus().select();
    }

    // Module export
    module.setupDlg = setupDlg;
    module.openDlg = openDlg;

    log.info("module loaded");
    return module;

}());

export default the_module;

