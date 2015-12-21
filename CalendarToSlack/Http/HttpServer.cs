using System;
using System.Collections.Generic;
using System.IO;
using System.Net;
using System.Net.Http;
using System.Reflection;
using System.Text;
using System.Threading.Tasks;
using System.Web.Helpers;
using log4net;

namespace CalendarToSlack.Http
{
    class HttpServer
    {
        private static readonly ILog Log = LogManager.GetLogger(typeof (HttpServer).Name);

        private bool _keepRunning = true;

        private readonly string _slackClientId;
        private readonly string _slackClientSecret;
        private readonly Slack _slack;
        private readonly UserDatabase _database;

        public HttpServer(string slackClientId, string slackClientSecret, Slack slack, UserDatabase database)
        {
            if (string.IsNullOrWhiteSpace(slackClientId))
            {
                throw new ArgumentException("Cannot start HTTP server without a Slack application client ID; it's needed for OAuth");
            }

            if (string.IsNullOrWhiteSpace(slackClientSecret))
            {
                throw new ArgumentException("Cannot start HTTP server without a Slack application client secret; it's needed for OAuth");
            }

            if (slack == null)
            {
                throw new ArgumentNullException("slack");
            }

            if (database == null)
            {
                throw new ArgumentNullException("database");
            }

            _slackClientId = slackClientId;
            _slackClientSecret = slackClientSecret;
            _slack = slack;
            _database = database;
        }

        public void Start()
        {
            // TODO document the prerequisite: netsh http add urlacl url=http://+:40042/ user=Everyone

            var listener = new HttpListener();
            listener.Prefixes.Add("http://+:40042/");
            listener.Start();

            Log.DebugFormat("HTTP server started");

            Task.Run(() => Listen(listener));
        }

        public void Pause()
        {
            _keepRunning = false;
        }

        public void Resume()
        {
            _keepRunning = true;
        }

        // TODO configurable startup port

        private void Listen(HttpListener listener)
        {
            while (_keepRunning)
            {
                var context = listener.GetContext(); // Blocks.
                HandleRequest(context);
            }
        }

        private void HandleRequest(HttpListenerContext context)
        {
            try
            {
                var req = context.Request;

                Log.DebugFormat("Requested {0}", req.RawUrl);

                var path = req.RawUrl.Split('?')[0].TrimEnd('/');
                if (path == "")
                {
                    var page = GetIndexPage(_slackClientId);
                    SendHtml(context.Response, 200, page);
                    return;
                }

                if (path == "/callback")
                {
                    var client = new HttpClient()
                    {
                        Timeout = TimeSpan.FromSeconds(5),
                    };

                    var code = req.QueryString["code"];

                    var content = new FormUrlEncodedContent(new List<KeyValuePair<string, string>>
                    {
                        new KeyValuePair<string, string>("client_id", _slackClientId),
                        new KeyValuePair<string, string>("client_secret", _slackClientSecret),
                        new KeyValuePair<string, string>("code", code),
                    });

                    var response = client.PostAsync("https://slack.com/api/oauth.access", content).Result;
                    if (response.IsSuccessStatusCode)
                    {
                        var responseContent = response.Content.ReadAsStringAsync().Result;
                        var json = Json.Decode(responseContent);

                        if (!json.ok)
                        {
                            SendHtml(context.Response, 500, "Non-ok response from OAuth access request");
                            return;
                        }

                        var token = json.access_token;
                        var user = _slack.GetUserInfo(token);

                        if (_database.AddUser(user, token))
                        {
                            _slack.PostSlackbotMessage(token, user.Username, "Hey there! I'll be modifying your Slack free/away status when events come up on your calendar. How neat is that?\nSee https://github.com/robhruska/CalendarToSlack/wiki for all the cool things I can do.");
                        }

                        SendHtml(context.Response, 200, "Added " + user.Email + ". Check out <a href=\"https://github.com/robhruska/CalendarToSlack/wiki\">the wiki</a>.");
                    }
                    else
                    {
                        SendHtml(context.Response, 500, "Error getting OAuth token");
                    }

                    return;
                }

                if (path == "/reload-db")
                {
                    _database.ManualReload();
                    SendHtml(context.Response, 200, "Done.");
                    return;
                }

                SendHtml(context.Response, 404, "Huh?");
            }
            catch (Exception e)
            {
                Log.Error("Error handling HTTP request", e);
                SendHtml(context.Response, 500, "<pre>" + e + "</pre>");
            }
        }

        private static void SendHtml(HttpListenerResponse response, int status, string content)
        {
            var output = Encoding.UTF8.GetBytes(content);
            response.StatusCode = status;
            response.ContentType = "text/html; charset=utf-8";
            response.ContentEncoding = Encoding.UTF8;
            response.ContentLength64 = output.Length;
            response.Close(output, false);
        }

        // Not super optimal - could stream these instead. But it's so
        // low traffic and lightweight that it doesn't matter, and this is
        // a bit faster to get going.
        private static string GetIndexPage(string slackClientId)
        {
            var assembly = Assembly.GetExecutingAssembly();
            using (var stream = assembly.GetManifestResourceStream("CalendarToSlack.Http.Resources.index.html"))
            using (var reader = new StreamReader(stream))
            {
                var content = reader.ReadToEnd();
                return content.Replace("{{SlackClientId}}", slackClientId);
            }
        }
    }
}
