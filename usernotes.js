// ==UserScript==
// @name        Mod User Notes
// @namespace   http://www.reddit.com/r/toolbox
// @author      agentlame, creesch
// @description Create and display user notes for mods.
// @include     *://www.reddit.com/*
// @include     *://reddit.com/*
// @include     *://*.reddit.com/*
// @downloadURL http://userscripts.org/scripts/source/170091.user.js
// @version     1.5.0
// ==/UserScript==

function usernotes() {
    if (!reddit.logged || !TBUtils.setting('UserNotes', 'enabled', true)) return;

    var subs = [];

    TBUtils.getModSubs(function () {
        run();
    });
    
    var PERMA_TO_THING_ID = /\/(\w+)\/\w+\/?$/;
    
    var ConstManager = function(init_pools) {
        return {
            _pools: init_pools,
            create: function(poolName, constant) {
                var pool = this._pools[poolName];
                var id = pool.indexOf(constant);
                if(id !== -1)
                    return id;
                pool.push(constant);
                return pool.length - 1;
            },
            get: function(poolName, id) {
                return this._pools[poolName][id];
            }
        };
    }
    
    function permaToThingID(permalink) {
        var linkMatches = permalink.match(PERMA_TO_THING_ID);
        if(linkMatches.length > 1) {
            return linkMatches[1];
        } else {
            return "";
        }
    }

    function postToWiki(sub, json) {
        TBUtils.noteCache[sub] = json;
        json = deflateNotes(json);

        TBUtils.postToWiki('usernotes', sub, json, true, false, function done(succ, err) {
            if (succ) {
                run();
            } else {
                console.log(err.responseText);
            }
        });
    }

    // RES NER support.
    $('div.content').on('DOMNodeInserted', function (e) {
        if (e.target.parentNode.id && e.target.parentNode.id === 'siteTable' && e.target.className.match(/sitetable/)) {
            run();
        }

        // Fixes expanding bug in mod mail.
        if ($(e.target).hasClass('clearleft')) {
            setTimeout(function () {
                run();
            }, 1000);
        }
    });

    function processThing(thing) {

        if ($(thing).hasClass('ut-processed')) {
            return;
        }
        $(thing).addClass('ut-processed');

        var subreddit = TBUtils.getThingInfo(thing, true).subreddit;

        if (!subreddit) return;

        var tag = '<span class="usernote-span-' +
            subreddit + '" style="color:#888888; font-size:x-small;">&nbsp;[<a class="add-user-tag-' +
            subreddit + '" id="add-user-tag" "href="javascript:;">N</a>]</span>';

        $(thing).attr('subreddit', subreddit);

        // More mod mail hackery... all this to see your own tags in mod mail.  It's likely not worth it.
        var userattrs = $(thing).find('.userattrs');
        if ($(userattrs).html() !== null) {
            $(userattrs).after(tag);
        } else {
            $(thing).find('.head').after(tag);
        }

        if ($.inArray(subreddit, subs) == -1) {
            subs.push(subreddit);
        }
    }

    function processSub(currsub) {
        if (TBUtils.noteCache[currsub] !== undefined) {
            setNotes(TBUtils.noteCache[currsub], currsub);
            return;
        }

        if (!currsub || TBUtils.noNotes.indexOf(currsub) != -1) return;

        TBUtils.readFromWiki(currsub, 'usernotes', true, function (resp) {
            if (!resp || resp === TBUtils.WIKI_PAGE_UNKNOWN) {
                return;
            }

            if (resp === TBUtils.NO_WIKI_PAGE) {
                TBUtils.noNotes.push(currsub);
                return;
            }

            if (!resp || resp.length < 1) {
                TBUtils.noNotes.push(currsub);
                return;
            }
            
            resp = convertNotes(resp);
            
            TBUtils.noteCache[currsub] = resp;
            setNotes(resp, currsub);
        });
    }
    
    // Inflate notes from the database, converting between versions if necessary.
    function convertNotes(notes) {
        // ver 2 is pretty close to the in-memory format.
        if(notes.ver <= 2) {
            notes.users.forEach(function(user) {
                user.notes.forEach(function(note) {
                    if(note.link && note.link.trim()) {
                        // get just the link ID
                        note.link = permaToThingID(note.link);
                    }
                });
            });
            notes.ver = TBUtils.notesSchema;
            return notes;
        }
        else if(notes.ver == 3) {
            return inflateNotes(notes);
        }
        
        //TODO: throw an error if unrecognized version?
    }
    
    // Compress notes so they'll store well in the database.
    function deflateNotes(notes) {
        var deflated = {
            ver: TBUtils.notesSchema,
            constants: {
                users: [],
                warnings: []
            }
        };
        
        var mgr = new ConstManager(deflated.constants);
        
        deflated.users = notes.users.map(function(user) {
            return {
                "u": mgr.create("users", user.name),
                "ns": user.notes.map(function(note) {
                    return {
                        "n": note.note,
                        "t": note.time,
                        "m": mgr.create("users", note.mod),
                        "l": note.link,
                        "w": mgr.create("warnings", note.type),
                    };
                })
            };
        });
        
        return deflated;
    }
    
    // Decompress notes from the database into a more useful format
    function inflateNotes(deflated) {
        var notes = {
            ver: TBUtils.notesSchema,
            users: []
        };
        
        var mgr = new ConstManager(deflated.constants);
        
        notes.users = deflated.users.map(function(user) {
            return {
                "name": mgr.get("users", user.u),
                "notes": user.ns.map(function(note) {
                    return {
                        "note": note.n,
                        "time": note.t,
                        "mod": mgr.get("users", note.m),
                        "link": note.l,
                        "type": mgr.get("warnings", note.w),
                    };
                })
            };
        });
        
        return notes;
    }

    function setNotes(notes, subreddit) {
        $.log("notes = " + notes);
        $.log("notes.ver = " + notes.ver);
        
        // schema check.
        if (notes.ver > TBUtils.notesSchema) {
          
          // Remove the option to add notes.
          $('.usernote-span-' + subreddit).remove();
          
            TBUtils.alert("You are using a version of toolbox that cannot read a newer usernote data format.  Please update your extension.", function(clicked) {
                if (clicked) window.open("http://www.reddit.com/r/toolbox/wiki/download");
            });
            return;
        }

        var things = $('div.thing .entry[subreddit=' + subreddit + ']');
        TBUtils.forEachChunked(things, 25, 250, function (thing) {
            var user = TBUtils.getThingInfo(thing).user;

            $.grep(notes.users, function (u) {

                if (u.name == user) {
                    var usertag = $(thing).find('.add-user-tag-' + subreddit);

                    // Only happens if you delete the last note.
                    if (u.notes.length < 1) {
                        $(usertag).css('color', '');
                        $(usertag).text('N');
                        return;
                    }
                    note = unescape(u.notes[0].note).substring(0, 50);
                    $(usertag).html('<b>' + TBUtils.htmlEncode(note) + '</b>' + ((u.notes.length > 1) ? '  (+' + (u.notes.length - 1) + ')' : ''));

                    var type = u.notes[0].type;
                    if (!type) type = 'none';

                    $(usertag).css('color', TBUtils.getTypeInfo(type).color);
                }
            });
        });
    }

    function run() {
        var things = $('div.thing .entry:not(.ut-processed)');

        TBUtils.forEachChunked(things, 25, 500, processThing, function () {
            TBUtils.forEachChunked(subs, 10, 500, processSub);
        });
    }

    $('body').delegate('#add-user-tag', 'click', function (e) {
        var thing = $(e.target).closest('.thing .entry'),
            info = TBUtils.getThingInfo(thing),
            subreddit = info.subreddit,
            user = info.user,
            link = permaToThingID(info.permalink);

        // Make box & add subreddit radio buttons
        var popup = $(
            '<div class="utagger-popup">\
				<div class="utagger-popup-header">User tagger for <a href="http://reddit.com/u/' + user + '" id="utagger-user-link">/u/' + user + '</a></div>\
				<div class="utagger-popup-content">\
					<table class="utagger-notes"><tbody><tr>\
						<td class="utagger-notes-td1">Author</td>\
						<td class="utagger-notes-td2">Note</td>\
						<td class="utagger-notes-td3"></td>\
					</tr></tbody></table>\
					<table class="utagger-type"><tbody>\
					<tr>\
                    <td><input type="radio" name="type-group" class="utagger-type-input" id="utagger-type-none" value="none" checked/><label for="utagger-type-none" style="color: #369;">None</label></td>\
					</tr>\
					</tbody></table>\
					<span>\
						<input type="text" placeholder="something about the user..." class="utagger-user-note" data-link="' + link + '" data-subreddit="' + subreddit + '" data-user="' + user + '">\
						<br><label><input type="checkbox" class="utagger-include-link" checked /> include link</label>\
					</span>\
				</div>\
				<div class="utagger-popup-footer">\
						<input type="button" class="utagger-save-user" value="save for /r/' + subreddit + '">\
						<input type="button" class="utagger-cancel-user" value="cancel">\
				</div>\
				</div>'
        )
            .appendTo('body')
            .css({
                left: e.pageX - 50,
                top: e.pageY - 10,
                display: 'block'
            });

        var $table = popup.find('.utagger-type tr:first');
        $(TBUtils.warningType).each(function () {
            var info = TBUtils.getTypeInfo(this);
            $table.append('<td><input type="radio" name="type-group" class="utagger-type-input" id="utagger-type-' + this + '" value="' + this + '"><label for="utagger-type-' + this + '" style="color: ' + info.color + ';">' + info.text + '</label></td>');
        });

        TBUtils.readFromWiki(subreddit, 'usernotes', true, function (resp) {
            if (!resp || resp === TBUtils.WIKI_PAGE_UNKNOWN || resp === TBUtils.NO_WIKI_PAGE || resp.length < 1) {
                TBUtils.noNotes.push(currsub);
                return;
            }
            
            resp = convertNotes(resp);
            
            TBUtils.noteCache[subreddit] = resp;

            $.grep(resp.users, function (u) {
                if (u.name == user) {
                    popup.find('#utagger-type-' + u.notes[0].type).prop('checked',true);
                    
                    var i = 0;
                    $(u.notes).each(function () {
                        if (!this.type) this.type = 'none';

                        var info = TBUtils.getTypeInfo(this.type);
                        var typeSpan = '';

                        if (info.name) {
                            typeSpan = '<span style="color: ' + TBUtils.htmlEncode(info.color) + ';">[' + TBUtils.htmlEncode(info.name) + ']</span> ';
                        }
                        
                        popup.find('table.utagger-notes').append('<tr><td class="utagger-notes-td1">' + this.mod + ' <br> <span class="utagger-date" id="utagger-date-' + i + '">' + new Date(this.time).toLocaleString() + '</span></td><td lass="utagger-notes-td2">' + typeSpan + unescape(this.note) + '</td><td class="utagger-notes-td3"><img class="utagger-remove-note" noteid="' + this.time + '" src="data:image/png;base64,' + TBUtils.iconclose + '" /></td></tr>');
                        if (this.link) {
                            popup.find('#utagger-date-' + i).wrap('<a href="http://redd.it/' + encodeURIComponent(this.link) + '">');
                        }
                        i++;
                    });
                }
            });
        });
    });

    $('body').delegate('.utagger-save-user, .utagger-remove-note', 'click', function (e) {
        var popup = $(this).closest('.utagger-popup'),
            unote = popup.find('.utagger-user-note'),
            subreddit = unote.attr('data-subreddit'),
            user = unote.attr('data-user'),
            noteid = $(e.target).attr('noteid'),
            noteText = unote.val(),
            deleteNote = (e.target.className == 'utagger-remove-note'),
            type = popup.find('.utagger-type-input:checked').val(),
            link = '',
            note = TBUtils.note,
            notes = TBUtils.usernotes;

        if (popup.find('.utagger-include-link').is(':checked')) {
            link = unote.attr('data-link');
        }

        if ((!user || !subreddit || !noteText) && !deleteNote) return;

        note = {
            note: escape(noteText),
            time: new Date().getTime(),
            mod: reddit.logged,
            link: link,
            type: type
        };

        var userNotes = {
            name: user,
            notes: []
        };

        userNotes.notes.push(note);

        $(popup).remove();

        TBUtils.readFromWiki(subreddit, 'usernotes', true, function (resp) {
            if (resp === TBUtils.WIKI_PAGE_UNKNOWN) {
                return;
            }

            if (resp === TBUtils.NO_WIKI_PAGE) {
                notes.users.push(userNotes);
                postToWiki(subreddit, notes);
                return;
            }

            // if we got this far, we have valid JSON
            notes = resp = convertNotes(resp);

            if (notes) {
                var results = $.grep(notes.users, function (u) {
                    if (u.name == user) {

                        // Delete. 
                        if (deleteNote) {
                            $(u.notes).each(function (idx) {

                                if (this.time == noteid) {
                                    u.notes.splice(idx, 1);
                                }
                            });

                            postToWiki(subreddit, notes);
                            return true;

                            // Add.
                        } else {
                            u.notes.unshift(note);
                            postToWiki(subreddit, notes);
                            return u;
                        }
                    }
                });

                if ((!results || results.length < 1) && !deleteNote) {
                    notes.users.push(userNotes);
                    postToWiki(subreddit, notes);
                }
            } else {
                notes.users.push(userNotes);
                postToWiki(subreddit, notes);
            }
        });
    });

    $('body').delegate('.utagger-cancel-user', 'click', function () {
        var popup = $(this).closest('.utagger-popup');
        $(popup).remove();
    });
}

// Add script to page
(function () {

    // Check if we are running as an extension
    if (typeof self.on !== "undefined" || (typeof chrome !== "undefined" && chrome.extension)) {
        init();
        return;
    }

    // Check if TBUtils has been added.
    if (!window.TBUadded) {
        window.TBUadded = true;

        var utilsURL = 'http://agentlame.github.io/toolbox/tbutils.js';
        var cssURL = 'http://agentlame.github.io/toolbox/tb.css';
        $('head').prepend('<script type="text/javascript" src=' + utilsURL + '></script>');
        $('head').prepend('<link rel="stylesheet" type="text/css" href="' + cssURL + '"></link>');
    }

    // Do not add script to page until TBUtils is added.
    (function loadLoop() {
        setTimeout(function () {
            if (typeof TBUtils !== "undefined") {
                init();
            } else {
                loadLoop();
            }
        }, 100);
    })();

    function init() {
        var s = document.createElement('script');
        s.textContent = "(" + usernotes.toString() + ')();';
        document.head.appendChild(s);
    }
})();
