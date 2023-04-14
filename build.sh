#!/bin/bash

bash ./setup.sh

rm -fr dist
mkdir -p dist
cp -r app dist

cd dist
web-ext build -s app

