using System.Collections.Generic;
using System.IO;
using CalendarToSlack.Http;
using System;

namespace CalendarToSlack
{
    // TODO error handling, move beyond a prototype
    // TODO convert to a service?

    class Program
    {
        // args[0] = exchange username
        // args[1] = exchange password
        // args[2] = CalendarToSlack slack application client ID
        // args[3] = CalendarToSlack slack application client secret
        // args[4] = CalendarToSlack slash command verification token
        // args[5] = AWS access key
        // args[6] = AWS secret key
        // args[7] = AWS SQS queue URL
        static void Main(string[] args)
        {
            var slack = new Slack();

            var dbfile = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.ApplicationData), "calendar-to-slack-users.txt");
            Out.WriteInfo("Loading user database from {0}", dbfile);

            var database = new UserDatabase(dbfile, slack);

            var calendar = new Calendar(args[0], args[1]);

            var updater = new Updater(database, calendar, slack);
            updater.Start();

            var consumer = new SlackCommandConsumer(args[4], args[5], args[6], args[7], updater);
            consumer.Start();

            var server = new HttpServer(args[2], args[3], slack, database);
            server.Start();
            
            Console.ReadLine();
        }
    }

    public static class Out
    {
        public static void WriteDebug(string line, params object[] args)
        {
            Write(ConsoleColor.Gray, line, args);
        }

        public static void WriteInfo(string line, params object[] args)
        {
            Write(ConsoleColor.Green, line, args);
        }


        public static void WriteStatus(string line, params object[] args)
        {
            Write(ConsoleColor.Cyan, line, args);
        }

        private static void Write(ConsoleColor color, string line, params object[] args)
        {
            var orig = Console.ForegroundColor;
            Console.ForegroundColor = color;
            var l = string.Format("[{0}] {1}", DateTime.UtcNow.ToString("yyyy'-'MM'-'dd HH':'mm':'ss fffffff K"), line);
            Console.WriteLine(l, args);
            Console.ForegroundColor = orig;
        }
    }
}
