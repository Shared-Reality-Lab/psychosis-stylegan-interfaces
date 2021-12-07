
import numpy as np
import json
import argparse
import re
import os
import os.path
import shutil

def main():
    # parse args
    parser = argparse.ArgumentParser(description="Formatting user data from map exploration (json file) to style mix folder.")
    parser.add_argument('--source-json',help="json file with user data", required=True)
    parser.add_argument('--image-dir', help="Directory that contains source images", metavar='DIR',required=True)
    parser.add_argument('--result-dir',help="Directory to store the results")
    args = parser.parse_args()

    with open(args.source_json, "r") as jsonfile:
        data = json.load(jsonfile)

    # retrieve user id and pass from json filename
    pattern_id = "\/?(\d{1,2})[a-z]\.json"
    pattern_pass = "\/?\d{1,2}([a-z])\.json"
    user_id = int(re.search(pattern_id,args.source_json).group(1))
    if re.search(pattern_pass,args.source_json).group(1) == "a":
        user_pass = 1
    elif re.search(pattern_pass,args.source_json).group(1) == "b":
        user_pass = 2
    else:
        return("Invalid pass")

    # create output dict and directory
    output_dict = {}
    if args.result_dir is None:
        if not os.path.exists('./%d' % (user_id)):
            os.makedirs('./%d' % (user_id))
        if os.path.exists('./%d/%d' % (user_id,user_pass)):
            return("Already formatted data for this pass and user")
        os.makedirs('./%d/%d' % (user_id,user_pass))
        path = "./%d/%d/" % (user_id,user_pass)
    else:
        if not os.path.exists(args.result_dir + '%d' % (user_id)):
            os.makedirs(args.result_dir + '%d' % (user_id))
        if os.path.exists(args.result_dir + '%d/%d' % (user_id,user_pass)):
            return("Already formatted data for this pass and user")
        os.makedirs(args.result_dir + '%d/%d' % (user_id,user_pass))
        path = args.result_dir + "%d/%d/" % (user_id,user_pass)
    for idx,value in enumerate(data['images']):
        output_dict[idx] = '/'+path+value

    # store image paths in selections.csv
    if args.result_dir is None: 
        with open('./%d/%d/selections.json' % (user_id,user_pass),'w') as jsonfile:
            json.dump(output_dict, jsonfile, indent=4)
    else:
        with open(args.result_dir+'%d/%d/selections.json' % (user_id,user_pass),'w') as jsonfile:
            json.dump(output_dict, jsonfile, indent=4)

    # copy image files in folder and best solution image
    for image in data['images']:
        shutil.copy2(args.image_dir+image,path)
        shutil.copy2(args.image_dir+data['choice'],path+'best_choice.png')
    
    return("Successfully formated data for style mixing")

if __name__ == "__main__":
    status = main()
    print(status)

