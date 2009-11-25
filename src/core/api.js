/**
 * Copyright Facebook Inc.
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 *
 *
 *
 * Contains the public method ``FB.api`` and the internal implementation
 * ``FB.RestServer``.
 *
 * @provides fb.api
 * @requires fb.prelude
 *           fb.qs
 *           fb.flash
 *           fb.md5sum
 *           fb.json2
 */

/**
 * API calls.
 *
 * @class FB
 * @static
 * @access private
 */
FB.copy('', {
  /**
   * Once you have a session for the current user, you will want to
   * access data about that user, such as getting their name & profile
   * picture, friends lists or upcoming events they will be
   * attending. In order to do this, you will be making signed API
   * calls to Facebook using their session. Suppose we want to alert
   * the current user's name:
   *
   *     FB.api(
   *       {
   *         method: 'fql.query',
   *         query: 'SELECT name FROM profile WHERE id=' + FB.getSession().uid
   *       },
   *       function(response) {
   *         alert(response[0].name);
   *       }
   *     );
   *
   * [[wiki:API]] Calls are documented on the wiki.
   *
   * [[wiki:FQL]] is the preferred way of reading data from Facebook
   * (write/update/delete queries are done via simpler URL parameters).
   * [[wiki:Fql.multiquery]] is also very crucial for good performance, as it
   * allows efficiently collecting different types of data.
   *
   * [[wiki:FQL Tables]] are available for various types of data.
   *
   * @access public
   * @param params {Object} parameters for the query
   * @param cb {Function} the callback function to handle the response
   */
  api: function(params, cb) {
    // this is an optional dependency on FB.Auth
    // Auth.revokeAuthorization affects the session
    if (FB.Auth && params.method == 'Auth.revokeAuthorization') {
      var old_cb = cb;
      cb = function(response) {
        if (response === true) {
          FB.Auth.setSession(null, 'notConnected');
        }
        old_cb && old_cb(response);
      };
    }
    
    if(window.isDemandWare) {
      var client = FB.RestServer.demandware(params, cb);
      return;
    }

    try {
      FB.RestServer.jsonp(params, cb);
    } catch (x) {
      if (FB.Flash.hasMinVersion()) {
        FB.RestServer.flash(params, cb);
      } else {
        throw new Error('Flash is required for this API call.');
      }
    }
  }
});

/**
 * API call implementations.
 *
 * @class FB.RestServer
 * @static
 * @access private
 */
FB.copy('RestServer', {
  _callbacks: {},

  /**
   * Sign the given params and prepare them for an API call using the current
   * session if possible.
   *
   * @access private
   * @param params {Object} the parameters to sign
   * @return {Object} the *same* params object back
   */
  sign: function(params) {
    // general api call parameters
    FB.copy(params, {
      api_key : FB._apiKey,
      call_id : (new Date()).getTime(),
      format  : 'json',
      v       : '1.0'
    });

    // indicate session signing if session is available
    if (FB._session) {
      FB.copy(params, {
        session_key : FB._session.session_key,
        ss          : 1
      });
    }

    // optionally generate the signature. we do this for both the automatic and
    // explicit case.
    if (FB._session) {
      // the signature is described at:
      // http://wiki.developers.facebook.com/index.php/Verifying_The_Signature
      params.sig = FB.md5sum(
        FB.QS.encode(params, '', false) + FB._session.secret
      );
    }

    return params;
  },


  /**
   * Make a API call to restserver.php. This call will be automatically signed
   * if a session is available. The call is made using JSONP, which is
   * restricted to a GET with a maximum payload of 2k (including the signature
   * and other params).
   *
   * @access private
   * @param params {Object}   the parameters for the query
   * @param cb     {Function} the callback function to handle the response
   */
  jsonp: function(params, cb) {
    var
      g      = FB.guid(),
      script = document.createElement('script'),
      url;

    // shallow clone of params, add callback and sign
    params = FB.RestServer.sign(
      FB.copy({ callback: 'FB.RestServer._callbacks.' + g }, params));

    url = FB._domain.api + 'restserver.php?' + FB.QS.encode(params);
    if (url.length > 2000) {
      throw new Error('JSONP only support a maximum of 2000 bytes of input.');
    }

    // this is the JSONP callback invoked by the response from restserver.php
    FB.RestServer._callbacks[g] = function(response) {
      cb(response);
      delete FB.RestServer._callbacks[g];
      script.parentNode.removeChild(script);
    };

    script.src = url;
    document.getElementsByTagName('head')[0].appendChild(script);
  },
  
  /**
   * Make a API call to restserver.php using Demandware Server Side JS.
   *
   * @access private
   * @param params {Object}   the parameters for the query
   * @param cb     {Function} the callback function to handle the response
   */
  demandware: function(params, cb) {
    var method, url, body, reqId;

    // shallow clone of params, sign, and encode as query string
    var bodyContent = FB.RestServer.sign(FB.copy({}, params));
    body = FB.QS.encode(bodyContent);
    url = FB._domain.api + 'restserver.php';

    // GET or POST
    var multipart = false;
    if (url.length + body.length > 2000) {
      method = 'POST';
    } else {
      method = 'GET';
      url += '?' + body;
      body = '';
    }
    if(params.multipart) {
      method = 'POST';
      body = "multi";
    }
    
    try {
      var client = dw.net.HTTPClient();
      client.setTimeout(200 * 1000);
      client.open(method, url);
      if(body != '') {
        if(params.multipart) {
          delete params.multipart;
          var parts = [];
          for(var key in bodyContent) {
            parts.push(new dw.net.HTTPRequestPart(key, bodyContent[key]))
          }
          client.sendMultiPart(parts)
        } else {
          client.send(body);
        }
      } else {
        client.enableCaching(60 * 10)
        client.send();
      }
      var message;
      if(client.statusCode < 400) {
        message = client.text;
        cb(JSON.parse(message))
      } else {
        throw("An error occurred with status code "+client.statusCode)
      }
    } catch(e) {
      if((e+"").match(/SocketTimeoutException/)) {
        cb({
          timeout: true
        });
        return;
      }
      throw e+"";
    }
  },
  

  /**
   * Make a API call to restserver.php using Flash.
   *
   * @access private
   * @param params {Object}   the parameters for the query
   * @param cb     {Function} the callback function to handle the response
   */
  flash: function(params, cb) {
    // only need to do this once
    if (!FB.RestServer.flash._init) {
      // the SWF calls this global function when a HTTP response is available
      // FIXME: remove global
      window.FB_OnXdHttpResult = function(reqId, data) {
        FB.RestServer._callbacks[reqId](FB.Flash.decode(data));
      };
      FB.RestServer.flash._init = true;
    }

    FB.Flash.onReady(function() {
      var method, url, body, reqId;

      // shallow clone of params, sign, and encode as query string
      body = FB.QS.encode(FB.RestServer.sign(FB.copy({}, params)));
      url = FB._domain.api + 'restserver.php';

      // GET or POST
      if (url.length + body.length > 2000) {
        method = 'POST';
      } else {
        method = 'GET';
        url += '?' + body;
        body = '';
      }

      // fire the request
      reqId = document.XdComm.sendXdHttpRequest(method, url, body, null);

      // callback
      FB.RestServer._callbacks[reqId] = function(response) {
        cb(JSON.parse(FB.Flash.decode(response)));
        delete FB.RestServer._callbacks[reqId];
      };
    });
  }
});
