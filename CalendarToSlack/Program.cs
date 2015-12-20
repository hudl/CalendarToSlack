using System.Collections.Generic;
using System.IO;
using System.Linq;
using CalendarToSlack.Http;
using System;

namespace CalendarToSlack
{
    // TODO error handling, move beyond a prototype
    // TODO convert to a service?

    class Program
    {
        static void Main(string[] args)
        {
            var configPath = Path.Combine(Directory.GetCurrentDirectory(), "config.txt");
            if (args.Length > 0)
            {
                configPath = args[0];
            }
            
            var config = LoadConfig(configPath);

            var slack = new Slack();

            var userdbfile = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.ApplicationData), "calendar-to-slack-users.txt");
            var markdbfile = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.ApplicationData), "calendar-to-slack-marks.txt");

            var userdb = new UserDatabase(userdbfile, slack);
            var markdb = new MarkedEventDatabase(markdbfile);

            var calendar = new Calendar(config[Config.ExchangeUsername], config[Config.ExchangePassword]);

            var updater = new Updater(userdb, markdb, calendar, slack);
            updater.Start();

            var consumer = new SlackCommandConsumer(
                config[Config.SlackCommandVerificationToken],
                config[Config.AwsAccessKey],
                config[Config.AwsSecretKey],
                config[Config.AwsSqsQueueUrl],
                updater);
            consumer.Start();

            var server = new HttpServer(config[Config.SlackApplicationClientId], config[Config.SlackApplicationClientSecret], slack, userdb);
            server.Start();
            
            Console.ReadLine();
        }

        private static Dictionary<Config, string> LoadConfig(string path)
        {
            var lines = File.ReadAllLines(path);
            return lines.Where(line => !line.StartsWith("#")).ToDictionary(line => (Config) Enum.Parse(typeof(Config), line.Split('=')[0]), line => line.Split('=')[1]);
        }

        private enum Config
        {
            ExchangeUsername,
            ExchangePassword,
            SlackApplicationClientId,
            SlackApplicationClientSecret,
            SlackCommandVerificationToken,
            AwsAccessKey,
            AwsSecretKey,
            AwsSqsQueueUrl,
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
