/**
 * The MIT License
 * Copyright (c) 2017 Population Register Centre
 *
 * Permission is hereby granted, free of charge, to any person obtaining a copy
 * of this software and associated documentation files (the "Software"), to deal
 * in the Software without restriction, including without limitation the rights
 * to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
 * copies of the Software, and to permit persons to whom the Software is
 * furnished to do so, subject to the following conditions:
 *
 * The above copyright notice and this permission notice shall be included in
 * all copies or substantial portions of the Software.
 *
 * THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
 * IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
 * FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
 * AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
 * LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
 * OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN
 * THE SOFTWARE.
 */
var request = require('request');
var url = require('url');
var fs = require('fs');
var http = require('http');
var https = require('https');
var express = require('express');
var cookieParser = require('cookie-parser');
var headerUtils = require('./lib/HeaderUtils.js');

var app = express();
app.use(cookieParser());
var config = {};

/**
 * Initializes applicaition with properties from config.json.
 * 
 */
function init() {
    config = JSON.parse(fs.readFileSync('config.json', 'utf8'));
    console.log("using the following config:\n" + JSON.stringify(config));
    var server;
    var clientBaseUrl;
    if (config.ssl) {
        if (!config.clientBaseUrl) {
            config.clientBaseUrl = 'https://localhost:' + config.port;
        }
        config.callbackUriHpa = encodeURI(config.clientBaseUrl + '/callback/hpa');
        config.callbackUriYpa = encodeURI(config.clientBaseUrl + '/callback/ypa');
        var privateKey = fs.readFileSync(config.ssl.privateKey, 'utf8');
        var certificate = fs.readFileSync(config.ssl.certificate, 'utf8');
        var credentials = { key: privateKey, cert: certificate, passphrase: config.ssl.passPhrase };
        server = https.createServer(credentials, app);
    } else {
        if (!config.clientBaseUrl) {
            config.clientBaseUrl = 'http://localhost:' + config.port;
        }
        config.callbackUriHpa = encodeURI(config.clientBaseUrl + '/callback/hpa');
        config.callbackUriYpa = encodeURI(config.clientBaseUrl + '/callback/ypa');
        server = http.createServer(app);
    }

    server.listen(config.port, function () {
        var port = config.port;
        console.log('Browse to ' + config.clientBaseUrl + '/register/hpa/[TEST_HETU]' + ' or ' + config.clientBaseUrl + '/register/ypa/[TEST_HETU]');
    });
}

/**
 * Resource for registering Web API HPA session for a user who will be acting as the delegate. 
 * First, function makes backend call to Web API to register the delegate. Then, it redirects
 * user's browser to the Web API selection UI.
 * 
 * :hetu is SSN of the delegate. That is, the authenticated user.
 */
app.get('/register/hpa/:hetu', function (request, response) {
    // test hetu 010180-9026
    register('hpa', request.params.hetu, config.callbackUriHpa, response).
        then(redirectToWebApiSelection).
        catch(function (reason) {
            console.error(reason);
            response.status(500).send("Failed to register HPA session.");
        });
});

/**
 * Resource for handling return from Web API selection UI. First changes OAuth code to OAuth token 
 * with Web API backend. Then using the token gets selected principal(s) from delegate Web API 
 * resource. Finally, gets and returns authorization information of principals.
 */
app.get('/callback/hpa', function (request, response) {
    var urlParts = url.parse(request.url, true);
    changeCodeToToken(request.cookies.webApiSessionId, urlParts.query.code, config.callbackUriHpa).
        then(getDelegate).
        then(getAuthorizations).
        then(function (authorizations) {
            response.status(200).send(authorizations);
        }).
        catch(function (reason) {
            console.error(reason);
            response.status(500).send("Failed to get authorization.");
        });
});

/**
 * Resource for registering Web API YPA session for a user who will be acting as the delegate. 
 * First, function makes backend call to Web API to register the delegate. Then, it redirects
 * user's browser to the Web API selection UI.
 * 
 * :hetu is SSN of the delegate. That is, the authenticated user.
 */
app.get('/register/ypa/:hetu', function (request, response) {
    // test hetu 010180-9026
    register('ypa', request.params.hetu, config.callbackUriYpa, response).
        then(redirectToWebApiSelection).
        catch(function (reason) {
            console.error(reason);
            response.status(500).send("Failed to register YPA session.");
        });
});

/**
 * Resource for handling return from Web API selection UI. First changes OAuth code to OAuth token 
 * with Web API backend. Then using the token gets and returns the company roles of the delegate.
 */
app.get('/callback/ypa', function (request, response) {
    var urlParts = url.parse(request.url, true);
    changeCodeToToken(request.cookies.webApiSessionId, urlParts.query.code, config.callbackUriYpa).
        then(getRoles).
        then(function (roles) {
            response.status(200).send(roles);
        }).
        catch(function (reason) {
            console.error(reason);
            response.status(500).send("Failed to get company roles.");
        });
});

/**
 * Function to handle registeration to the Web API backend.
 * 
 * @param {string} mode - Eather `HPA` or `YPA`.
 * @param {string} delegateHetu - SSN of the delegate.
 * @param {string} callbackUri - The location where the user's browser is redirected after the selection of principal.
 * @param {Object} response - Response to the browser.
 * @return {Promise}
 */
function register(mode, delegateHetu, callbackUri, response) {
    return new Promise(function (resolve, reject) {
        //Registering WEB API session
        var registerPath = '/service/' + mode + '/user/register/' + config.clientId + '/' + delegateHetu + '?requestId=nodeClient&endUserId=nodeEndUser';

        // Adding X-AsiointivaltuudetAuthorization header
        var checksumHeaderValue = headerUtils.xAuthorizationHeader(config.clientId, config.clientSecret, registerPath);

        var options = {
            method: 'GET',
            url: config.webApiUrl + registerPath,
            headers: {
                'X-AsiointivaltuudetAuthorization': checksumHeaderValue
            }
        };

        request(options, function (error, res, body) {
            if (!error && res.statusCode === 200) {
                try {
                    var data = JSON.parse(body);
                    //Don't do this in production. Don't expose webApiSessionId to the user.
                    response.cookie("webApiSessionId", data.sessionId);
                    resolve({ userId: data.userId, response: response, callbackUri: callbackUri });
                } catch (e) {
                    console.error("Exception thrown while parsing response body: " + body);
                    reject(e.stack);
                }
            } else {
                reject(res.toJSON());
            }
        });

    });
}

/**
 * Redirects user's browser to the Web API selection UI.
 * 
 * @param {Object} args - function arguments: 
 * {string} userId - id returned from Web API registration resource, 
 * {Object} response - response for the user's browser, 
 * {string} callbackUri - URL where user is redirected after the selection.
 * @return {Promise}
 */
function redirectToWebApiSelection(args) {
    return new Promise(function (resolve, reject) {
        var authorizeUrl = config.webApiUrl + '/oauth/authorize?client_id=' + config.clientId + '&response_type=code&redirect_uri=' + args.callbackUri + '&user=' + args.userId;
        args.response.writeHead(302, {
            'Location': authorizeUrl
        });
        args.response.end();
        resolve();
    });
}

/**
 * Changes OAuth code to token with Web API backend.
 * 
 * @param {string} webApiSessionId - Web API session ID.
 * @param {string} code - OAuth code from Web API callback URL
 * @param {string} callbackUri -  URI where the user was redirected after the selection.
 * @return {Promise}
 */
function changeCodeToToken(webApiSessionId, code, callbackUri) {
    return new Promise(
        (resolve, reject) => {
            console.log('Exchaning authorization code to access token...');
            var options = {
                method: 'POST',
                url: config.webApiUrl + '/oauth/token?code=' + code + '&grant_type=authorization_code&redirect_uri=' + callbackUri,
                headers: {
                    'Authorization': headerUtils.basicAuthorizationHeader(config.clientId, config.apiOauthSecret)
                },
            };
            request(options, function (error, res, body) {
                if (!error && res.statusCode === 200) {
                    try {
                        var data = JSON.parse(body);
                        //{"access_token":"12ea9653-814b-4b1f-a877-4aeecd92d2ba","token_type":"bearer","refresh_token":"77543b3a-8823-49ea-929e-a9b6b63a9403","expires_in":599,"scope":"read write trust"}
                        var args = {};
                        args.accessToken = data.access_token;
                        args.webApiSessionId = webApiSessionId;
                        resolve(args);
                    } catch (e) {
                        console.error("Exception thrown while parsing response body: " + body);
                        reject(e.stack);
                    }
                } else {
                    reject(res.toJSON());
                }
            });
        }
    );
}

/**
 * Makes delegate call to the Web API backed. Get the selected principal(s) with the call.
 * @param {object} args - Function arguments:
 * {string} accessToken - OAuth access token,
 * {string} webApiSessionId - Web API session id.
 * @return {Promise}
 */
function getDelegate(args) {
    return new Promise(function (resolve, reject) {
        var resourceUrl = '/service/hpa/api/delegate/' + args.webApiSessionId + '?requestId=nodeRequestID&endUserId=nodeEndUser';
        var checksumHeaderValue = headerUtils.xAuthorizationHeader(config.clientId, config.clientSecret, resourceUrl);
        console.log('Get ' + resourceUrl);
        var options = {
            method: 'GET',
            url: config.webApiUrl + resourceUrl,
            headers: {
                'Authorization': 'Bearer ' + args.accessToken,
                'X-AsiointivaltuudetAuthorization': checksumHeaderValue
            },
        };

        request(options, function (error, res, body) {
            if (!error && res.statusCode === 200) {
                try {
                    var principals = JSON.parse(body);
                    console.log("Response from " + resourceUrl + ': ' + body);
                    var result = {
                        webApiSessionId: args.webApiSessionId,
                        accessToken: args.accessToken,
                        principals: principals
                    };
                    resolve(result);
                } catch (e) {
                    console.error("Exception thrown while parsing response body: " + body);
                    reject(e.stack);
                }
            } else {
                reject(res.toJSON());
            }
        });
    });

}

/**
 * Makes authorization calls to the Web API backend, one for each selected 
 * principal. Get the authorizations for the principals.
 * 
 * @param {object} authArgs - Function arguments:
 * {string} accessToken - OAuth access token,
 * {string} webApiSessionId - Web API session id.
 * {array} principals - principal objects. 
 * @return {Promise}
 */
function getAuthorizations(authArgs) {
    return new Promise(function (resolve, reject) {
        var promises = [];
        for (var i = 0; i < authArgs.principals.length; i++) {
            promises.push(getAuthorization(authArgs.webApiSessionId, authArgs.accessToken, authArgs.principals[i]));
        }
        Promise.all(promises).then(function (values) {
            var authorizations = [];
            try {
                for (var j = 0; j < values.length; j++) {
                    if (values[j].errorMessage) {
                        reject(values[j].errorMessage);
                    }
                    authorizations.push(values[j]);
                }
                resolve(authorizations);
            } catch (e) {
                console.error("Exception thrown while parsing response body: " + body);
                reject(e.stack);
            }
        }).catch(function (reason) {
            reject(reason);
        });
    });
}

/**
 * Makes an authorization call to the Web API backend.
 * 
 * @param {string} webApiSessionId - Web API session ID.
 * @param {string} accessToken - OAuth access token.
 * @param {Object} principal - principal. 
 * @return {Promise}
 */
function getAuthorization(webApiSessionId, accessToken, principal) {
    return new Promise(function (resolve, reject) {
        var resourceUrl = '/service/hpa/api/authorization/' + webApiSessionId + '/' + principal.personId + '?requestId=nodeRequestID&endUserId=nodeEndUser';
        var checksumHeaderValue = headerUtils.xAuthorizationHeader(config.clientId, config.clientSecret, resourceUrl);
        console.log('Get ' + resourceUrl);
        var options = {
            method: 'GET',
            url: config.webApiUrl + resourceUrl,
            headers: {
                'Authorization': 'Bearer ' + accessToken,
                'X-AsiointivaltuudetAuthorization': checksumHeaderValue
            }
        };

        request(options, function (error, res, body) {
            if (!error && res.statusCode === 200) {
                try {
                    var data = JSON.parse(body);
                    data.principal = principal;
                    resolve(data);
                } catch (e) {
                    console.error("Exception thrown while parsing response body: " + body);
                    reject(e.stack);
                }
            } else {
                reject(res.toJSON());
            }
        });
    });
}

/**
 * Gets company roles from Web API backend.
 * 
 * @param {object} args - Function arguments:
 * {string} accessToken - OAuth access token,
 * {string} webApiSessionId - Web API session id.
 * @return {Promise}
 */
function getRoles(args) {
    return new Promise(function (resolve, reject) {
        var resourceUrl = '/service/ypa/api/organizationRoles/' + args.webApiSessionId + '?requestId=nodeRequestID&endUserId=nodeEndUser';
        var checksumHeaderValue = headerUtils.xAuthorizationHeader(config.clientId, config.clientSecret, resourceUrl);
        console.log('Get ' + resourceUrl);
        var options = {
            method: 'GET',
            url: config.webApiUrl + resourceUrl,
            headers: {
                'Authorization': 'Bearer ' + args.accessToken,
                'X-AsiointivaltuudetAuthorization': checksumHeaderValue
            },
        };

        request(options, function (error, res, body) {
            if (!error && res.statusCode === 200) {
                try {
                    var data = JSON.parse(body);
                    resolve(data);
                } catch (e) {
                    console.error("Exception thrown while parsing response body: " + body);
                    reject(e.stack);
                }
            } else {
                reject(res.toJSON());
            }
        });
    });
}

init();
