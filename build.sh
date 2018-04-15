#!/bin/bash

rm -fr dist
mkdir dist

cp -r COPYING dist/.
cp -r icons dist/icons
cp -r _locales dist/_locales
cp -r manifest.json dist/manifest.json
cp -r pkg dist/pkg
cp -r scripts dist/scripts
cp -r styles dist/styles
cp -r tiptab.html dist/.

cd dist
web-ext build
