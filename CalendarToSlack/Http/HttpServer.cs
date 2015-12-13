using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using System.Net;
using System.Net.Http;
using System.Reflection;
using System.Text;
using System.Threading.Tasks;

namespace CalendarToSlack.Http
{
    class HttpServer
    {
        private bool _keepRunning = true;

        private readonly string _slackClientId;
        private readonly string _slackClientSecret;

        public HttpServer(string slackClientId, string slackClientSecret)
        {
            if (string.IsNullOrWhiteSpace(slackClientId))
            {
                throw new ArgumentException("Cannot start HTTP server without a Slack application client ID; it's needed for OAuth");
            }

            if (string.IsNullOrWhiteSpace(slackClientSecret))
            {
                throw new ArgumentException("Cannot start HTTP server without a Slack application client secret; it's needed for OAuth");
            }

            _slackClientId = slackClientId;
            _slackClientSecret = slackClientSecret;
        }

        public void Start()
        {
            // TODO document the prerequisite: netsh http add urlacl url=http://+:40042/ user=Everyone

            var listener = new HttpListener();
            listener.Prefixes.Add("http://+:40042/");
            listener.Start();

            Console.WriteLine("[http] HTTP server started");

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

        // TODO
        // - lock db on read/write
        // - db ability to update records and write to disk on change (within r/w lock)
        // - add a 15-person limit in for sanity checking
        // - on startup, check user's slack last name and don't update if unnecessary
        // - how can we get their slack email address back with the oauth payload? or can we get it solely from the auth token?
        // - configurable startup port
        // - configurable slack app token/secret for oauth
        // - landing page with description of behavior, screenshots
        //   - instructions on how to disable (is it manual for now?)

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

                Console.WriteLine("[http] Requested {0}", req.RawUrl);

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
                        // TODO save token, display "what's next" html
                        SendHtml(context.Response, 200, "Success");
                    }
                    else
                    {
                        SendHtml(context.Response, 500, "Error getting OAuth token");
                    }

                    return;
                }

                SendHtml(context.Response, 404, "Huh?");
            }
            catch (Exception e)
            {
                Console.WriteLine(e);
            }
        }

        private void SendHtml(HttpListenerResponse response, int status, string content)
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
        private string GetIndexPage(string slackClientId)
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
