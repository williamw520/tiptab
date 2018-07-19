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

// wwhotkey module, for detecting multiple key pressed.
(function(scope, modulename) {
    "use strict";

    // No import.  No dependency.

    var module = function() { };       // Module object to be returned; local reference to the package object for use below.
    if (modulename)
        scope[modulename] = module;    // set module name in scope, otherwise caller sets the name with the returned module object.

    const MIN_MODIFIERS = 1;
    const MAX_MODIFIERS = 6;
    
    const VK_SHIFT      = 0x10;
    const VK_CTRL       = 0x11;
    const VK_ALT        = 0x12;
    const VK_META       = 0x5B;
    const VK_WINDOWS    = 0x5B;       // Windows key on Windows
    const VK_OPTION     = 0x12;       // Option key on Mac
    const VK_COMMAND    = 224;        // Command key on Mac (on Firefox it's 224).

    const MODIFIERS = [
        {   id: "shift",        name: "Shift",      vk_code: VK_SHIFT },
        {   id: "control",      name: "Control",    vk_code: VK_CTRL },
        {   id: "ctrl",         name: "Ctrl",       vk_code: VK_CTRL },
        {   id: "alt",          name: "Alt",        vk_code: VK_ALT },
        {   id: "meta",         name: "Meta",       vk_code: VK_META },
        {   id: "windows",      name: "Windows",    vk_code: VK_WINDOWS },
        {   id: "option",       name: "Option",     vk_code: VK_OPTION },
        {   id: "command",      name: "Command",    vk_code: VK_COMMAND },
    ];
    const MODIFIER_ID_TO_VKCODE     = MODIFIERS.reduce( (map, item) => { map[item.id] = item.vk_code; return map; }, {});
    const VKCODE_TO_MODIFIER_NAME   = MODIFIERS.reduce( (map, item) => { map[item.vk_code] = item.name; return map; }, {});
    const MODIFIER_NAME_TO_ID       = MODIFIERS.reduce( (map, item) => { map[item.name] = item.id; return map; }, {});

    // See definition in https://developer.mozilla.org/en-US/docs/Web/API/KeyboardEvent/key/Key_Values
    const UNPRINTABLE_KEYS = [
        {   id: "backspace",    name: "Backspace",  vk_code: 0x08 },
        {   id: "tab",          name: "Tab",        vk_code: 0x09 },
        {   id: "enter",        name: "Enter",      vk_code: 0x0D },
        {   id: "escape",       name: "Escape",     vk_code: 0x1B },
        {   id: "space",        name: "Space",      vk_code: 0x20 },
        {   id: "pageup",       name: "PageUp",     vk_code: 0x21 },
        {   id: "pagedown",     name: "PageDown",   vk_code: 0x22 },
        {   id: "end",          name: "End",        vk_code: 0x23 },
        {   id: "home",         name: "Home",       vk_code: 0x24 },
        {   id: "arrowleft",    name: "ArrowLeft",  vk_code: 0x25 },
        {   id: "arrowup",      name: "ArrowUp",    vk_code: 0x26 },
        {   id: "arrowright",   name: "ArrowRight", vk_code: 0x27 },
        {   id: "arrowdown",    name: "ArrowDown",  vk_code: 0x28 },
        {   id: "printscreen",  name: "PrintScreen",vk_code: 0x2C },
        {   id: "insert",       name: "Insert",     vk_code: 0x2D },
        {   id: "delete",       name: "Delete",     vk_code: 0x2E },
    ];

    const NON_ALPHABET_KEYS = [
        {   id: ";",            name: ";",          vk_code: 0x3B },
        {   id: "=",            name: "=",          vk_code: 0x3D },
        {   id: "-",            name: "-",          vk_code: 0xAD },
        {   id: ",",            name: ",",          vk_code: 0xBC },
        {   id: ".",            name: ".",          vk_code: 0xBE },
        {   id: "/",            name: "/",          vk_code: 0xBF },
        {   id: "`",            name: "`",          vk_code: 0xC0 },
        {   id: "\\",           name: "\\",         vk_code: 0xDC },
        {   id: "[",            name: "[",          vk_code: 0xDB },
        {   id: "]",            name: "]",          vk_code: 0xD3 },
        {   id: "'",            name: "'",          vk_code: 0xDE },
    ]

    const DIGIT_KEYS = [];
    for (let i = 0; i < 10; i++) {
        DIGIT_KEYS.push({
            id: String.fromCharCode(48 + i),    name: String.fromCharCode(48 + i),  vk_code: 48 + i
        });
    }
    
    const ALPHABET_KEYS = [];
    for (let i = 0; i < 26; i++) {
        ALPHABET_KEYS.push({
            id: String.fromCharCode(97 + i),    name: String.fromCharCode(65 + i),  vk_code: 65 + i
        });
    }

    const FN_KEYS = [];
    for (let i = 1; i < 13; i++) {
        FN_KEYS.push({
            id: `f${i}`,        name: `F${i}`,      vk_code: 111 + i
        });
    }
    
    const KEYS                  = [].concat.apply([], [ UNPRINTABLE_KEYS, DIGIT_KEYS, ALPHABET_KEYS, FN_KEYS, NON_ALPHABET_KEYS ]);
    const KEY_ID_TO_VKCODE      = KEYS.reduce( (map, item) => { map[item.id] = item.vk_code; return map; }, {});
    const VKCODE_TO_KEY_NAME    = KEYS.reduce( (map, item) => { map[item.vk_code] = item.name; return map; }, {});
    const KEY_NAME_TO_ID        = KEYS.reduce( (map, item) => { map[item.name] = item.id; return map; }, {});


    class ModifierKey {
        constructor(modifierIds) {
            this.modVKCodes = {};       // Track which modifier keycodes are on.
            this.clear();
            if (modifierIds) {
                modifierIds.map( id => MODIFIER_ID_TO_VKCODE[id] ).forEach( vkCode => this.modVKCodes[vkCode] = true );
            }
        }

        set shift(flag) { this.modVKCodes[VK_SHIFT] = flag  }
        set ctrl(flag)  { this.modVKCodes[VK_CTRL]  = flag  }
        set alt(flag)   { this.modVKCodes[VK_ALT]   = flag  }
        set meta(flag)  { this.modVKCodes[VK_META]  = flag  }
        get shift()     { return this.modVKCodes[VK_SHIFT]  }
        get ctrl()      { return this.modVKCodes[VK_CTRL]   }
        get alt()       { return this.modVKCodes[VK_ALT]    }
        get meta()      { return this.modVKCodes[VK_META]   }

        fromEvent(event) {
            this.shift = event.shiftKey;
            this.ctrl = event.ctrlKey;
            this.alt = event.altKey;
            this.meta = event.metaKey;
            // Windows key or Command key is not supported.
            // if (event.key == "OS")          // Firefox won't set event.metaKey, instead set event.key as "OS"
            //     this.meta = true;
        }

        clear() {
            this.shift = false;
            this.ctrl = false;
            this.alt = false;
            this.meta = false;
        }

        equals(obj2) {
            return this.shift == obj2.shift && this.ctrl == obj2.ctrl && this.alt == obj2.alt && this.meta == obj2.meta;
        }

        toString() {
            let str = "";
            if (this.shift) str += "Shift-";
            if (this.ctrl) str += "Ctrl-";
            if (this.alt) str += "Alt-";
            if (this.meta) str += "Meta-";
            return str;
        }
    }


    class KeySeq {

        // Create from a key sequence, i.e. shift-ctrl-x
        static ofKeySeq(keySeq) {
            let ks = new KeySeq();
            if (keySeq) {
                let idSeq = keySeq.toLowerCase();   // id is always in lower case.  Convert name to id if names are used.
                let ids = KeySeq.parseKeySeq(idSeq);
                if (KeySeq._validIds(ids)) {
                    ks.modKeys = new ModifierKey(ids.slice(0, ids.length-1));
                    let keyId = ids[ids.length-1];
                    ks.keyCode = KEY_ID_TO_VKCODE[keyId];
                } else {
                    throw new Error("Key sequence is not valid.");
                }
            }
            return ks;
        }

        // Create from a keydown event.
        static ofKeyboardEvent(event) {
            let ks = new KeySeq();
            let keyId = event.key.toLowerCase();
            ks.modKeys.fromEvent(event);
            ks.keyCode = KEY_ID_TO_VKCODE[keyId];
            return ks;
        }

        constructor() {
            this.modKeys = new ModifierKey();   // set the modifier on this directly if needed.
            this.keyCode = 0;
        }

        fromEvent(event) {
            this.modKeys.fromEvent(event);
            if (VKCODE_TO_KEY_NAME[event.keyCode]) {
                this.keyCode = event.keyCode;
            } else {
                this.keyCode = 0;
            }
        }

        clear() {
            this.modKeys.clear();
            this.keyCode = 0;
        }
        
        equals(obj2) {
            return this.modKeys.equals(obj2.modKeys) && this.keyCode == obj2.keyCode;
        }

        toString() {
            return this.modKeys.toString() + (VKCODE_TO_KEY_NAME[this.keyCode] ? VKCODE_TO_KEY_NAME[this.keyCode] : "");
        }


        static parseKeySeq(seq) {
            return seq.indexOf("-") > -1 ? seq.split("-") : seq.split("+");
        }

        static validKeyIdSequence(seq) {
            return KeySeq._validIds(KeySeq.parseKeySeq(seq.toLowerCase()));
        }

        static _validIds(ids) {
            if (ids.length < 1) return false;
            return KeySeq.validModiferIds(ids.slice(0, ids.length-1)) &&
                   KeySeq.validKeyId(ids[ids.length-1]);
        }

        static validModiferIds(modifierIds) {
            if (modifierIds.length < MIN_MODIFIERS) return false;
            if (modifierIds.length > MAX_MODIFIERS) return false;
            for (let i = 0; i < modifierIds.length; i++) {
                if (!MODIFIER_ID_TO_VKCODE.hasOwnProperty(modifierIds[i]))
                    return false;
            }
            return true;
        }

        static validKeyId(keyId) {
            return KEY_ID_TO_VKCODE[keyId];
        }

    }


    // Module export
    module.MODIFIERS = MODIFIERS;
    module.MODIFIER_ID_TO_VKCODE = MODIFIER_ID_TO_VKCODE;
    module.VKCODE_TO_MODIFIER_NAME = VKCODE_TO_MODIFIER_NAME;
    module.MODIFIER_NAME_TO_ID = MODIFIER_NAME_TO_ID;

    module.KEYS = KEYS;
    module.UNPRINTABLE_KEYS = UNPRINTABLE_KEYS;
    module.NON_ALPHABET_KEYS = NON_ALPHABET_KEYS;
    module.KEY_ID_TO_VKCODE = KEY_ID_TO_VKCODE;
    module.VKCODE_TO_KEY_NAME = VKCODE_TO_KEY_NAME;
    module.KEY_NAME_TO_ID = KEY_NAME_TO_ID;

    module.ModifierKey = ModifierKey;
    module.KeySeq = KeySeq;
    module.ofKeySeq = KeySeq.ofKeySeq;
    module.ofKeyboardEvent = KeySeq.ofKeyboardEvent;

    module.validKeyIdSequence = KeySeq.validKeyIdSequence;
    
    return module;

}(this, "wwhotkey"));    // Pass in the global scope as 'this' scope.


// Unit Tests
let _RUNTEST_WWHOTKEY = false;
if (_RUNTEST_WWHOTKEY) {
    function json(obj)  { return JSON.stringify(obj, null, 4) };
    function has(a, b)  { return a.indexOf(b) > -1 };

    console.log("Run unit tests");

    // console.log(json( wwhotkey.ofKeySeq() ));
    // console.log(json( wwhotkey.ofKeySeq("shift-b") ));
    // console.log(json( wwhotkey.ofKeySeq("ctrl-shift-alt-b") ));
    // console.log(json( wwhotkey.ofKeySeq("option-command-meta-ctrl-shift-alt-b") ));

    console.assert( wwhotkey.ofKeySeq().modKeys.shift == false, "Assert failed" );
    console.assert( wwhotkey.ofKeySeq().modKeys.ctrl  == false, "Assert failed" );
    console.assert( wwhotkey.ofKeySeq().modKeys.alt   == false, "Assert failed" );
    console.assert( wwhotkey.ofKeySeq().modKeys.meta  == false, "Assert failed" );
    console.assert( wwhotkey.ofKeySeq().keyCode       == 0,     "Assert failed" );

    console.assert( wwhotkey.ofKeySeq("shift-b").modKeys.shift == true,  "Assert failed" );
    console.assert( wwhotkey.ofKeySeq("shift-b").modKeys.ctrl  == false, "Assert failed" );
    console.assert( wwhotkey.ofKeySeq("shift-b").modKeys.alt   == false, "Assert failed" );
    console.assert( wwhotkey.ofKeySeq("shift-b").modKeys.meta  == false, "Assert failed" );
    console.assert( wwhotkey.ofKeySeq("shift-b").keyCode       == 65+1,  "Assert failed" );

    ["shift-b", "ctrl-b", "alt-b", "meta-b"].forEach( seq => {
        console.assert( wwhotkey.ofKeySeq(seq).modKeys.shift == has(seq, "shift"),  "Assert failed: " + seq );
        console.assert( wwhotkey.ofKeySeq(seq).modKeys.ctrl  == has(seq, "ctrl"),   "Assert failed: " + seq );
        console.assert( wwhotkey.ofKeySeq(seq).modKeys.alt   == has(seq, "alt"),    "Assert failed: " + seq );
        console.assert( wwhotkey.ofKeySeq(seq).modKeys.meta  == has(seq, "meta"),   "Assert failed: " + seq );
        console.assert( wwhotkey.ofKeySeq(seq).keyCode       == 65+1,               "Assert failed: " + seq );
    });

    ["shift-ctrl-b", "ctrl-shift-b", "alt-shift-b", "meta-alt-b"].forEach( seq => {
        console.assert( wwhotkey.ofKeySeq(seq).modKeys.shift == has(seq, "shift"),  "Assert failed: " + seq );
        console.assert( wwhotkey.ofKeySeq(seq).modKeys.ctrl  == has(seq, "ctrl"),   "Assert failed: " + seq );
        console.assert( wwhotkey.ofKeySeq(seq).modKeys.alt   == has(seq, "alt"),    "Assert failed: " + seq );
        console.assert( wwhotkey.ofKeySeq(seq).modKeys.meta  == has(seq, "meta"),   "Assert failed: " + seq );
        console.assert( wwhotkey.ofKeySeq(seq).keyCode       == 65+1,               "Assert failed: " + seq );
    });

    ["shift-ctrl-option-command-alt-b"].forEach( seq => {
        console.assert( wwhotkey.ofKeySeq(seq).modKeys.shift == has(seq, "shift"),  "Assert failed: " + seq );
        console.assert( wwhotkey.ofKeySeq(seq).modKeys.ctrl  == has(seq, "ctrl"),   "Assert failed: " + seq );
        console.assert( wwhotkey.ofKeySeq(seq).modKeys.alt   == has(seq, "alt"),    "Assert failed: " + seq );
        console.assert( wwhotkey.ofKeySeq(seq).modKeys.meta  == has(seq, "meta"),   "Assert failed: " + seq );
        console.assert( wwhotkey.ofKeySeq(seq).keyCode       == 65+1,               "Assert failed: " + seq );
    });

    ["shift", "ctrl", "alt", "meta"].forEach( mod => {
        for (let i = 0; i < 26; i++) {
            let seq = mod + "-" + String.fromCharCode(97 + i);      // 'a' to 'z'
            console.assert( wwhotkey.ofKeySeq(seq).modKeys.shift == has(seq, "shift"),  "Assert failed: " + seq );
            console.assert( wwhotkey.ofKeySeq(seq).modKeys.ctrl  == has(seq, "ctrl"),   "Assert failed: " + seq );
            console.assert( wwhotkey.ofKeySeq(seq).modKeys.alt   == has(seq, "alt"),    "Assert failed: " + seq );
            console.assert( wwhotkey.ofKeySeq(seq).modKeys.meta  == has(seq, "meta"),   "Assert failed: " + seq );
            console.assert( wwhotkey.ofKeySeq(seq).keyCode       == 65+i,               "Assert failed: " + seq );
        }
        for (let i = 0; i < 10; i++) {
            let seq = mod + "-" + String.fromCharCode(48 + i);      // '0' to '9'
            console.assert( wwhotkey.ofKeySeq(seq).modKeys.shift == has(seq, "shift"),  "Assert failed: " + seq );
            console.assert( wwhotkey.ofKeySeq(seq).modKeys.ctrl  == has(seq, "ctrl"),   "Assert failed: " + seq );
            console.assert( wwhotkey.ofKeySeq(seq).modKeys.alt   == has(seq, "alt"),    "Assert failed: " + seq );
            console.assert( wwhotkey.ofKeySeq(seq).modKeys.meta  == has(seq, "meta"),   "Assert failed: " + seq );
            console.assert( wwhotkey.ofKeySeq(seq).keyCode       == 48+i,               "Assert failed: " + seq );
        }
    });
    
    try { wwhotkey.ofKeySeq("b"); console.error("Assert on expected exception.") } catch { };
    
    console.assert( wwhotkey.ofKeySeq("").equals( wwhotkey.ofKeySeq("") ),  "Assert failed: equals" );
    console.assert( !wwhotkey.ofKeySeq("").equals( wwhotkey.ofKeySeq("shift-b") ), "Assert failed: equals" );
    console.assert( !wwhotkey.ofKeySeq("shift-b").equals( wwhotkey.ofKeySeq("") ), "Assert failed: equals" );
    console.assert( !wwhotkey.ofKeySeq("shift-b").equals( wwhotkey.ofKeySeq("shift-c") ), "Assert failed: equals" );
    console.assert( !wwhotkey.ofKeySeq("shift-b").equals( wwhotkey.ofKeySeq("alt-b") ), "Assert failed: equals" );
    console.assert( !wwhotkey.ofKeySeq("shift-b").equals( wwhotkey.ofKeySeq("meta-b") ), "Assert failed: equals" );
    console.assert( !wwhotkey.ofKeySeq("shift-b").equals( wwhotkey.ofKeySeq("shift-alt-b") ), "Assert failed: equals" );
    console.assert( !wwhotkey.ofKeySeq("shift-b").equals( wwhotkey.ofKeySeq("alt-meta-c") ), "Assert failed: equals" );
    
    let ks1 = wwhotkey.ofKeySeq("shift-alt-b");
    ks1.modKeys.shift = false;
    console.assert( ks1.modKeys.shift == false, "Assert failed: ", ks1 );
    console.assert( ks1.modKeys.ctrl  == false, "Assert failed: ", ks1 );
    console.assert( ks1.modKeys.alt   == true,  "Assert failed: ", ks1 );
    console.assert( ks1.modKeys.meta  == false, "Assert failed: ", ks1 );
    console.assert( ks1.toString()    == "Alt-B", "Assert failed: ", ks1 );

}

