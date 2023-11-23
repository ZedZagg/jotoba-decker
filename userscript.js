// ==UserScript==
// @name         Jotoba Decker
// @namespace    https://github.com/ZedZagg
// @version      0.1
// @description  Build anki decks from Jotoba.de
// @author       ZedZagg
// @match        https://jotoba.de/*
// @icon         https://jotoba.de/JotoBook.png
// @grant        GM.getValue
// @grant        GM.setValue
// ==/UserScript==

(function() {
    'use strict';

    // observer to watch for the word list to be created
    let incomingWordObserver = new MutationObserver(observeInitialWords);
    const observerProperties = { attributes: false, childList: true, subtree: true }
    incomingWordObserver.observe(document, observerProperties)

    // find main header so we can add our anki menu button to it
    let mainHeaderObserver = new MutationObserver(initMainHeader);
    mainHeaderObserver.observe(document, observerProperties)

    // load saved word set
    let wordSet;
    const wordSetStorageKey = "wordSet";
    GM.getValue( wordSetStorageKey, new Set() )
        .then(value => { wordSet = new Set(value);});

    // watches mutations from the first page load and adds buttons where necessary
    // once the word list is found, the observer is disconnected and a new one placed on the list
    function observeInitialWords(mutations, observer){
        for(const mutation of mutations){
            for(const node of mutation.addedNodes){
                if(node.classList && node.classList.contains("words")){
                    incomingWordObserver.disconnect(); // disconnect the observer before we add buttons or else we'll loop infinitely

                    for(const wordEntry of node.querySelectorAll('.word-entry'))
                        addAnkiButton(wordEntry);

                    // pivot the mutation observer to a new instance that watches only the word list
                    incomingWordObserver = new MutationObserver(observeAdditionalWords.bind(null, node));
                    incomingWordObserver.observe(node, observerProperties)
                    return;
                }
            }
        }
    }

    // watches mutations for changes to the word list
    // sometimes (like on refresh) this doesn't occur
    function observeAdditionalWords(observedNode, mutations, observer){
        observer.disconnect(); // gotta dc brb
        for(const mutation of mutations){
            for(const node of mutation.addedNodes){
                // sometimes we get text nodes so we need to filter to div.word-entry
                if(node.nodeName === "DIV" && node.classList.contains("word-entry")){
                    addAnkiButton(node)
                }
            }
        }
        observer.observe(observedNode, observerProperties); // back
    }

    // create, configure and add an "add to anki deck" button on a div.word-entry node
    function addAnkiButton(wordEntryNode){
        let headNode = wordEntryNode.querySelector('.entry-head');

        // get word value
        let word = "";
        let ruby = headNode.querySelector('ruby');
        for(let node of ruby.childNodes.entries()){
            if(node[1].nodeName === "#text") word += node[1].textContent;
        }

        // create/add anki button
        let ankiButton = document.createElement('button');
        ankiButton.style.backgroundImage = "url(https://upload.wikimedia.org/wikipedia/commons/thumb/3/3d/Anki-icon.svg/800px-Anki-icon.svg.png)";
        ankiButton.style.backgroundRepeat = "no-repeat";
        ankiButton.style.backgroundSize = "contain";                               // >Oh you should use a class, styles are bad practise
        ankiButton.style.width = "15px";                                           // No, I won't.
        ankiButton.style.marginLeft = "auto";                                      // If it bothers you, you write the code.
        ankiButton.style.marginRight = "20px";

        // add/remove word from saved word set on click
        ankiButton.onclick = async () => {
            if(!wordSet.has(word)){
                let data = await fetchWordDetails(word);
                await addWordToCollection(data);
                ankiButton.style.opacity = 1.0;
            }
            else{
                await deleteWordFromCollection(word);
                ankiButton.style.opacity = 0.5;
            }
        }

        if(wordSet && !wordSet.has(word))
            ankiButton.style.opacity = 0.5;

        headNode.appendChild(ankiButton);
    }

    function createAnkiCardString(wordDetails){

    }

    // fetch word details from jotoba backend
    async function fetchWordDetails(word){
        const query = {
                         "query": word,
                         "language": "English",
                         "no_english": false
                      };
        const url = "https://jotoba.de/api/search/words";

        const response = await fetch(url, {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
            },
            body: JSON.stringify(query)
        });
        const data = await response.json();
        return data.words[0];
    }

    // populate the main header on the jotoba page with an anki menu button
    function initMainHeader(mutations, observer){
        const mainHeader = document.getElementById('mainHeader');
        if(mainHeader){
            console.log("found main header", mainHeader)
            observer.disconnect()

            let ankiButton = document.createElement('button');
            ankiButton.style.backgroundImage = "url(https://upload.wikimedia.org/wikipedia/commons/thumb/3/3d/Anki-icon.svg/800px-Anki-icon.svg.png)";
            ankiButton.style.backgroundRepeat = "no-repeat";
            ankiButton.style.backgroundSize = "contain";
            ankiButton.style.width = "40px";
            ankiButton.style.height = "45px";
            ankiButton.id = "anki-menu-button"
            ankiButton.onclick = async () => {
                console.log(wordSet, await GM.listValues().then(value => value.filter(key => key !== "wordSet")));
            }

            function addAnkiMenuButton(){
                if(mainHeader.querySelector('#anki-menu-button')) return; // nothing to be done

                const parentEl = mainHeader.classList.contains("mobile") ?
                                     mainHeader.querySelector("div.right") :
                                     mainHeader.querySelector("div.top-row>div.utils-bundle");

                if(!parentEl){
                    console.error("Failed to find element to attach anki menu button to in main header", mainHeader)
                    return;
                }

                parentEl.appendChild(ankiButton);
            }

            addAnkiMenuButton();

            let attributeChangeObserver = new MutationObserver(addAnkiMenuButton);
            mainHeaderObserver.observe(mainHeader, { attributes: true, childList: true, subtree: true });
        }
    }

    async function deleteWordFromCollection(word){
        let wordDeletePromise = GM.deleteValue(word);
        wordSet.delete(word);
        let setSavePromise = GM.setValue( wordSetStorageKey, [...wordSet]);
        await Promise.all([wordDeletePromise, setSavePromise]);
    }

    async function addWordToCollection(wordData){
        const key = wordData.reading.kanji;

        wordSet.add(key);
        let setSavePromise = GM.setValue( wordSetStorageKey, [...wordSet]);

        let wordSavePromise = GM.setValue( key, wordData);

        await Promise.all([setSavePromise, wordSavePromise]);
    }
})();
