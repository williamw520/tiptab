#!/bin/bash

rm -fr web-ext-artifacts
rm -fr dist

find . -name "*~"  -exec rm {} \;
find . -name "*#*" -exec rm {} \;

