using System;
using System.Collections.Generic;
using System.Linq;
using System.Net;
using System.Text;
using System.Threading.Tasks;

namespace CalendarToSlack.Http
{
    class HttpServer
    {
        private bool _keepRunning = true;

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

                var req = context.Request;

                Console.WriteLine("[http] Requested {0}", req.RawUrl);

                var output = Encoding.UTF8.GetBytes("Hello");
                context.Response.StatusCode = 200;
                context.Response.ContentType = "text/html; charset=utf-8";
                context.Response.ContentEncoding = Encoding.UTF8;
                context.Response.ContentLength64 = output.Length;
                context.Response.Close(output, false);
            }
        }
    }
}
